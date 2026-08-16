import {MgT2SkillDialog} from "./skill-dialog.mjs";
import {MgT2SpacecraftAttackDialog} from "./spacecraft-attack-dialog.mjs";
import {MgT2SpacecraftRepairDialog} from "./spacecraft-repair-dialog.mjs";
import {setCourse} from "./naval-course.mjs";

const { renderTemplate } = foundry.applications.handlebars;

// Minimal target+speed prompt for the "setCourse" special. This is a stand-in for Phase 1
// verification purposes - once the Ship Console panel exists (Phase 2), the Pilot's own console
// will set course directly and this dialog fallback becomes unnecessary, but runCrewAction still
// needs a working call path today since this is the only current entry point for the action.
async function promptSetCourse(shipActor) {
    const maxSpeed = parseInt(shipActor.system.spacecraft.mdrive) || 0;
    const otherShips = (game.combat?.combatants ?? [])
        .map(c => c.actor)
        .filter(actor => actor?.type === "spacecraft" && actor.id !== shipActor.id);

    if (otherShips.length === 0) {
        ui.notifications.error("No other ships in the encounter to set a course toward.");
        return null;
    }

    const currentTarget = shipActor.getFlag("mgt2e-piggy", "navTarget");
    const options = otherShips.map(s =>
        `<option value="${s.id}" ${s.id === currentTarget ? "selected" : ""}>${s.name}</option>`
    ).join("");

    const data = await foundry.applications.api.DialogV2.input({
        window: { title: `${shipActor.name} - Set Course` },
        content: `
            <p>Orient toward, and commit speed toward (0-${maxSpeed}):</p>
            <select name="target">${options}</select>
            <input type="number" name="speed" value="${maxSpeed}" min="0" max="${maxSpeed}" step="1"/>
        `
    });
    if (!data) {
        return null;
    }
    const speed = Math.max(0, Math.min(maxSpeed, parseInt(data.speed) || 0));
    return { targetId: data.target, speed };
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

        } else if (action.special === "setCourse") {
            if (!game.combat) {
                ui.notifications.error("Setting course requires an active combat encounter.");
                return;
            }
            const choice = await promptSetCourse(shipActor);
            if (!choice) {
                return;
            }
            const { navTarget, navSpeed } = await setCourse(shipActor, choice.targetId, choice.speed);
            const targetShip = game.actors.get(navTarget);

            const content = await renderTemplate(
                "systems/mgt2e-piggy/templates/chat/ship-course-set.html",
                {
                    actor: shipActor,
                    rollerName: actorCrew.name,
                    targetName: targetShip?.name ?? "Unknown ship",
                    speed: navSpeed
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
