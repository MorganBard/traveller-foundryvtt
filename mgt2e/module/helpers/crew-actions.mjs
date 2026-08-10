import {MgT2SkillDialog} from "./skill-dialog.mjs";
import {MgT2SpacecraftAttackDialog} from "./spacecraft-attack-dialog.mjs";
import {MgT2SpacecraftRepairDialog} from "./spacecraft-repair-dialog.mjs";
import {MgT2ChangeHeadingDialog} from "./change-heading-dialog.mjs";
import {setShipFacing, applyThrust, bearingOfShip} from "./naval-maneuver.mjs";

const { renderTemplate } = foundry.applications.handlebars;

// Prompts for how much of the ship's Thrust rating to spend on a maneuver (1 up to maxThrust,
// defaulting to the max). Returns null if the dialog is cancelled/closed, or if there's no
// Thrust available to spend at all. Shared by Close/Open/Accelerate/Decelerate so a pilot can
// deliberately hold some Thrust back - e.g. to have something left for Evasive Action later
// in the round, which depends entirely on Thrust that maneuvering didn't already spend.
async function promptThrustAmount(shipName, maxThrust) {
    if (maxThrust <= 0) {
        ui.notifications.error(`${shipName} has no Thrust available to maneuver with.`);
        return null;
    }
    const data = await foundry.applications.api.DialogV2.input({
        window: { title: `${shipName} - Spend Thrust` },
        content: `
            <p>How much Thrust to spend (1-${maxThrust})?</p>
            <input type="number" name="thrust" value="${maxThrust}" min="1" max="${maxThrust}" step="1" autofocus/>
        `
    });
    if (!data) {
        return null;
    }
    const thrust = Math.min(maxThrust, Math.max(1, parseInt(data.thrust) || 0));
    return thrust;
}

// Dispatches a single crew-role action: skill rolls, weapon attacks, and the various
// spacecraft "special" actions (initiative, maneuvering, evade, repair...). Standalone (no
// dependency on any actor-sheet instance) so it's callable from any UI - the actor sheet's own
// role-action buttons, the crew-member dialog, and the GM Naval Combat Control panel all call
// this same function rather than duplicating the dispatch logic.
export async function runCrewAction(shipActor, actorCrewId, roleId, actionId) {
    console.log("runCrewAction: " + actorCrewId);
    const actorCrew = game.actors.get(actorCrewId);
    if (!actorCrew) {
        ui.notifications.warn(game.i18n.format("MGT2.Warn.Crew.NoCrewActor", { crewId: actorCrewId}));
        return;
    }
    const itemRole = shipActor.items.get(roleId);
    if (!itemRole) {
        ui.notifications.warn(game.i18n.format("MGT2.Warn.Crew.NoCrewActor", { roleId: roleId}));
        return;
    }
    const action = itemRole.system.role.actions[actionId];

    if (action.action === "chat") {
        let chatData = {
            user: game.user.id,
            speaker: {
                actor: actorCrew._id,
                alias: game.i18n.format("MGT2.Role.ChatAlias", {
                    "actorName": actorCrew.name, "shipName": shipActor.name
                }),
                scene: game.scenes.current.id
            },
            content: `${action.chat}`
        }
        ChatMessage.create(chatData, {});
    } else if (action.action === "skill") {
        let skill = action.skill;
        let cha = action.cha;
        let target = isNaN(action.target)?null:parseInt(action.target);
        let dm = action.dm?action.dm:0;

        if (!skill) {
            return;
        } else if (skill.startsWith("pilot")) {
            if (shipActor.getFlag("mgt2e-piggy", "damage_pilotDM")) {
                dm += parseInt(shipActor.getFlag("mgt2e-piggy", "damage_pilotDM"));
            }
        } else if (skill === "engineer.jDrive") {
            if (shipActor.getFlag("mgt2e-piggy", "damage_jumpDM")) {
                dm += parseInt(shipActor.getFlag("mgt2e-piggy", "damage_jumpDM"));
            }
        }

        new MgT2SkillDialog(actorCrew, skill, {
            "dm": dm,
            "cha": cha,
            "difficulty": target,
            "text": action.text
        }).render(true);
    } else if (action.action === "weapon") {
        let weaponId = action.weapon;
        let weaponItem = shipActor.items.get(weaponId);
        let dm = parseInt(action.dm);
        console.log(weaponItem);
        new MgT2SpacecraftAttackDialog(shipActor, actorCrew, weaponItem, dm).render(true);
    } else if (action.action === "special") {
        if (action.special === "pilot") {
            // Core rulebook: ship initiative is 2D + the pilot's Pilot skill + the ship's Thrust
            // (M-Drive rating). This establishes the ship's base initiative for the round; the
            // Captain's Combat Tactics check (below) adds its Effect on top of this.
            let pilotSkill = actorCrew.getSkillValue("pilot.spacecraft");
            let thrust = parseInt(shipActor.system.spacecraft.mdrive) || 0;
            let roll = await new Roll("2D6 + " + pilotSkill + " + " + thrust).evaluate();

            shipActor.setFlag("mgt2e-piggy", "initPilotDM", pilotSkill);
            shipActor.setFlag("mgt2e-piggy", "initPilotName", actorCrew.name);
            shipActor.setFlag("mgt2e-piggy", "shipInitiativeRoll", roll.total);
            shipActor.setFlag("mgt2e-piggy", "shipInitiativePilotName", actorCrew.name);
            shipActor.unsetFlag("mgt2e-piggy", "shipInitiativeTacticsName");

            const dice = roll.dice.flatMap(die => die.results.map(result => ({
                result: result.result,
                cssClass: result.result === 6 ? "max" : (result.result === 1 ? "min" : "")
            })));
            const content = await renderTemplate(
                "systems/mgt2e-piggy/templates/chat/ship-pilot-initiative-roll.html",
                {
                    actor: shipActor,
                    dice,
                    pilotSkill,
                    thrust,
                    total: roll.total,
                    rollerName: actorCrew.name
                }
            );
            const pilotSpeaker = {
                actor: actorCrew._id,
                alias: game.i18n.format("MGT2.Role.ChatAlias", {
                    "actorName": actorCrew.name, "shipName": shipActor.name
                }),
                scene: game.scenes.current.id
            };
            const pilotMessageData = await roll.toMessage(
                {speaker: pilotSpeaker},
                {
                    create: false,
                    messageMode: game.settings.get("core", "rollMode")
                }
            );
            pilotMessageData.content = content;
            await ChatMessage.create(pilotMessageData);

            if (game.combat) {
                const combatant = game.combat.combatants.find(c => c.actor?.id === shipActor.id);
                if (combatant) {
                    await game.combat.setInitiative(combatant.id, roll.total);
                }
            }
        } else if (action.special === "tacticsInit") {
            let tacticsDM = actorCrew.getSkillValue("tactics.naval", { "addcha": true });
            let roll = await new Roll("2D6 + " + tacticsDM).evaluate();
            let effect = roll.total - 8;

            let previousTotal = shipActor.getFlag("mgt2e-piggy", "shipInitiativeRoll");
            let baseWasSet = previousTotal !== undefined && previousTotal !== null;
            let newTotal = (baseWasSet ? previousTotal : 0) + effect;

            shipActor.setFlag("mgt2e-piggy", "shipInitiativeRoll", newTotal);
            shipActor.setFlag("mgt2e-piggy", "shipInitiativeTacticsName", actorCrew.name);

            const dice = roll.dice.flatMap(die => die.results.map(result => ({
                result: result.result,
                cssClass: result.result === 6 ? "max" : (result.result === 1 ? "min" : "")
            })));
            const content = await renderTemplate(
                "systems/mgt2e-piggy/templates/chat/ship-initiative-roll.html",
                {
                    actor: shipActor,
                    dice,
                    statModifier: tacticsDM,
                    total: roll.total,
                    effect,
                    previousTotal,
                    baseWasSet,
                    newTotal,
                    rollerName: actorCrew.name
                }
            );
            const speaker = {
                actor: actorCrew._id,
                alias: game.i18n.format("MGT2.Role.ChatAlias", {
                    "actorName": actorCrew.name, "shipName": shipActor.name
                }),
                scene: game.scenes.current.id
            };
            const messageData = await roll.toMessage(
                {speaker},
                {
                    create: false,
                    messageMode: game.settings.get("core", "rollMode")
                }
            );
            messageData.content = content;
            await ChatMessage.create(messageData);

            if (game.combat) {
                const combatant = game.combat.combatants.find(c => c.actor?.id === shipActor.id);
                if (combatant) {
                    await game.combat.setInitiative(combatant.id, newTotal);
                }
            }

        } else if (action.special === "maneuverClose" || action.special === "maneuverOpen") {
            const direction = action.special === "maneuverClose" ? "closing" : "opening";
            if (!game.combat) {
                ui.notifications.error("Maneuvering requires an active combat encounter.");
                return;
            }
            const targets = Array.from(game.user.targets);
            if (targets.length !== 1) {
                ui.notifications.error("Target exactly one other ship to maneuver against.");
                return;
            }
            const targetShip = targets[0].actor;
            if (!targetShip || targetShip.type !== "spacecraft" || targetShip.id === shipActor.id) {
                ui.notifications.error("Target must be a different spacecraft.");
                return;
            }
            const maxThrust = parseInt(shipActor.system.spacecraft.mdrive) || 0;
            const thrust = await promptThrustAmount(shipActor.name, maxThrust);
            if (!thrust) {
                return;
            }

            const headingSector = await bearingOfShip(game.combat, shipActor, targetShip);
            await setShipFacing(shipActor, headingSector);

            const { newFacing, changes } = await applyThrust(game.combat, shipActor, thrust, direction);

            const content = await renderTemplate(
                "systems/mgt2e-piggy/templates/chat/ship-maneuver-roll.html",
                {
                    actor: shipActor,
                    targetName: targetShip.name,
                    direction,
                    thrust,
                    newFacing,
                    changes: changes.map(c => ({
                        ...c,
                        actorName: game.actors.get(c.actorId)?.name ?? "Unknown ship"
                    }))
                }
            );
            const speaker = {
                actor: actorCrew._id,
                alias: game.i18n.format("MGT2.Role.ChatAlias", {
                    "actorName": actorCrew.name, "shipName": shipActor.name
                }),
                scene: game.scenes.current.id
            };
            await ChatMessage.create({ user: game.user.id, speaker, content });

        } else if (action.special === "changeHeading") {
            if (!game.combat) {
                ui.notifications.error("Changing heading requires an active combat encounter.");
                return;
            }
            new MgT2ChangeHeadingDialog(shipActor, actorCrew).render(true);

        } else if (action.special === "accelerate" || action.special === "decelerate") {
            const direction = action.special === "accelerate" ? "closing" : "opening";
            if (!game.combat) {
                ui.notifications.error("Maneuvering requires an active combat encounter.");
                return;
            }
            const maxThrust = parseInt(shipActor.system.spacecraft.mdrive) || 0;
            const thrust = await promptThrustAmount(shipActor.name, maxThrust);
            if (!thrust) {
                return;
            }
            const { newFacing, changes } = await applyThrust(game.combat, shipActor, thrust, direction);

            const content = await renderTemplate(
                "systems/mgt2e-piggy/templates/chat/ship-thrust-roll.html",
                {
                    actor: shipActor,
                    label: action.special === "accelerate" ? "Accelerate" : "Decelerate",
                    thrust,
                    newFacing,
                    changes: changes.map(c => ({
                        ...c,
                        actorName: game.actors.get(c.actorId)?.name ?? "Unknown ship"
                    }))
                }
            );
            const thrustSpeaker = {
                actor: actorCrew._id,
                alias: game.i18n.format("MGT2.Role.ChatAlias", {
                    "actorName": actorCrew.name, "shipName": shipActor.name
                }),
                scene: game.scenes.current.id
            };
            await ChatMessage.create({ user: game.user.id, speaker: thrustSpeaker, content });

        } else if (action.special === "improveInit") {

        } else if (action.special === "evade") {
            // Core rulebook: the pilot may dodge incoming attacks so long as the ship has
            // unspent Thrust after maneuvering. Each point of unspent Thrust allows one
            // dodge attempt, at a DM equal to the pilot's skill, applied against the attack.
            const thrust = parseInt(shipActor.system.spacecraft.mdrive) || 0;
            const spent = parseInt(shipActor.getFlag("mgt2e-piggy", "thrustSpentThisRound")) || 0;
            const unspentThrust = Math.max(0, thrust - spent);
            const pilotSkill = actorCrew.getSkillValue("pilot.spacecraft");

            if (unspentThrust === 0) {
                ui.notifications.warn("No unspent Thrust remaining - maneuver less this round to have Thrust available to evade with.");
                return;
            }

            await shipActor.setFlag("mgt2e-piggy", "evadeChargesRemaining", unspentThrust);
            // Stored pre-negated - this is the actual DM applied to an incoming attack, not
            // the raw pilot skill, so every reader of this flag can just add it directly.
            await shipActor.setFlag("mgt2e-piggy", "evadeDM", -pilotSkill);
            await shipActor.setFlag("mgt2e-piggy", "evadePilotName", actorCrew.name);

            const content = await renderTemplate(
                "systems/mgt2e-piggy/templates/chat/ship-evade-roll.html",
                {
                    actor: shipActor,
                    rollerName: actorCrew.name,
                    attackDM: -pilotSkill,
                    unspentThrust
                }
            );
            const evadeSpeaker = {
                actor: actorCrew._id,
                alias: game.i18n.format("MGT2.Role.ChatAlias", {
                    "actorName": actorCrew.name, "shipName": shipActor.name
                }),
                scene: game.scenes.current.id
            };
            await ChatMessage.create({ user: game.user.id, speaker: evadeSpeaker, content });

        } else if (action.special === "repair") {
            // Open ship repair dialog.
            new MgT2SpacecraftRepairDialog(shipActor, actorCrew).render(true);
        }
    }
}
