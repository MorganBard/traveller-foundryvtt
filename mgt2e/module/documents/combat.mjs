import { findAssignedPilot, computeShipInitiativeTotal, requestCombatTacticsIfNeeded } from "../helpers/ship-initiative.mjs";

const {renderTemplate} = foundry.applications.handlebars;

export async function rollTravellerInitiative(combat, actor, combatants) {
    const dexModifier = Number(actor.system.characteristics?.DEX?.dm) || 0;
    const intModifier = Number(actor.system.characteristics?.INT?.dm) || 0;
    const statName = dexModifier === intModifier
        ? "DEX/INT"
        : (dexModifier > intModifier ? "DEX" : "INT");
    let bonus = 0;
    let bonusLabel = null;
    if (actor.getEffect("surprised")) {
        bonus = -6;
        bonusLabel = "Surprised";
    } else if (actor.getEffect("aware")) {
        bonus = 6;
        bonusLabel = "Aware";
    }

    for (const combatant of combatants) {
        const roll = await new Roll(
            `2D6 + @initiative.value + ${bonus}`,
            actor.getRollData()
        ).evaluate();
        const effect = roll.total - 8;
        const dice = roll.dice.flatMap(die => die.results.map(result => ({
            result: result.result,
            cssClass: result.result === 6 ? "max" : (result.result === 1 ? "min" : "")
        })));
        const content = await renderTemplate(
            "systems/mgt2e-piggy/templates/chat/initiative-roll.html",
            {
                actor,
                dice,
                statName,
                statModifier: actor.system.initiative.value,
                bonus,
                bonusLabel,
                total: roll.total,
                effect
            }
        );

        const messageData = await roll.toMessage(
            {speaker: ChatMessage.getSpeaker({actor})},
            {
                create: false,
                messageMode: game.settings.get("core", "rollMode")
            }
        );
        messageData.content = content;
        await ChatMessage.create(messageData);
        await combat.setInitiative(combatant.id, effect);
    }
}

export async function rollShipInitiative(combat, actor, combatants) {
    const existingPilotBase = actor.getFlag("mgt2e-piggy", "shipInitiativeRoll");
    const existingCombatId = actor.getFlag("mgt2e-piggy", "shipInitiativeRollCombatId");
    // Must match the CURRENT combat, not just exist - shipInitiativeRoll isn't cleared when one
    // encounter ends and a new one begins (only the combatRound hook clears it, and only between
    // rounds of the same still-active combat), so without this check a brand new encounter would
    // silently reuse a stale roll from a previous, unrelated fight.
    const alreadyRolled = existingPilotBase !== undefined && existingPilotBase !== null
        && existingCombatId === combat.id;

    if (alreadyRolled) {
        // Pilot base already rolled this round (persists across rounds unless the
        // shipInitiativePerRound setting cleared it) - reuse it rather than rolling again.
        const pilotName = actor.getFlag("mgt2e-piggy", "shipInitiativePilotName");
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor}),
            content: `${actor.name} uses its already-rolled Pilot initiative` +
                (pilotName ? ` (Pilot: ${pilotName})` : "") + `: ${existingPilotBase}`
        });
    } else {
        // Core rulebook: ship initiative is 2D + the Pilot's Pilot skill + the ship's Thrust
        // (M-Drive rating). This is a flat additive roll, not a real decision (no target
        // number), so it's rolled by the system directly - no player interaction needed.
        const pilot = findAssignedPilot(actor);
        const pilotSkill = pilot?.crewActor ? pilot.crewActor.getSkillValue("pilot.spacecraft") : 0;
        const thrust = parseInt(actor.system.spacecraft.mdrive) || 0;
        const roll = await new Roll("2D6 + " + pilotSkill + " + " + thrust).evaluate();

        const dice = roll.dice.flatMap(die => die.results.map(result => ({
            result: result.result,
            cssClass: result.result === 6 ? "max" : (result.result === 1 ? "min" : "")
        })));
        const rollerName = pilot?.crewActor?.name ?? "(unassigned Pilot)";

        await actor.setFlag("mgt2e-piggy", "initPilotDM", pilotSkill);
        await actor.setFlag("mgt2e-piggy", "initPilotName", pilot?.crewActor?.name ?? null);
        await actor.setFlag("mgt2e-piggy", "shipInitiativeRoll", roll.total);
        await actor.setFlag("mgt2e-piggy", "shipInitiativeRollCombatId", combat.id);
        await actor.setFlag("mgt2e-piggy", "shipInitiativePilotName", pilot?.crewActor?.name ?? "Unassigned");
        // Kept so a later Combat Tactics chat card (which can resolve minutes or rounds after
        // this roll) can redisplay the base roll's own dice, not just its numeric total.
        await actor.setFlag("mgt2e-piggy", "shipInitiativeBaseDice", { dice, pilotSkill, thrust, rollerName });

        const content = await renderTemplate(
            "systems/mgt2e-piggy/templates/chat/ship-pilot-initiative-roll.html",
            {
                actor,
                dice,
                pilotSkill,
                thrust,
                total: roll.total,
                rollerName
            }
        );
        const messageData = await roll.toMessage(
            {speaker: ChatMessage.getSpeaker({actor})},
            {
                create: false,
                messageMode: game.settings.get("core", "rollMode")
            }
        );
        messageData.content = content;
        await ChatMessage.create(messageData);
    }

    // Improve Initiative (Leadership Check) banks its Effect for "the next round only" - apply
    // it exactly once (roundApplied still null means it hasn't been consumed yet), then stamp it
    // so no later Roll Initiative click, in this round or any future one, can apply it again.
    const banked = actor.getFlag("mgt2e-piggy", "pendingInitiativeBonus");
    if (banked && banked.combatId === combat.id && banked.roundApplied === null
        && combat.round > banked.bankedRound) {
        const newPilotBase = (parseInt(actor.getFlag("mgt2e-piggy", "shipInitiativeRoll")) || 0) + banked.value;
        await actor.setFlag("mgt2e-piggy", "shipInitiativeRoll", newPilotBase);
        await actor.setFlag("mgt2e-piggy", "pendingInitiativeBonus", { ...banked, roundApplied: combat.round });
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({actor}),
            content: `<strong>${actor.name}</strong>: Improve Initiative bonus applied: ` +
                `${banked.value >= 0 ? "+" : ""}${banked.value}.`
        });
    }

    // Combat Tactics (Naval) is a one-time-per-encounter request to the Captain's player - this
    // only sends it (or records why none was sent); resolution happens later, asynchronously,
    // via Tools.resolveCombatTacticsRequest, and re-sets initiative again whenever it lands. Must
    // run before computeShipInitiativeTotal below, so a fresh encounter's combatTacticsState is
    // reset before the total is computed - otherwise a stale, already-resolved Effect from a
    // previous encounter would still be sitting in the flag and get added in here.
    await requestCombatTacticsIfNeeded(combat, actor);

    const total = computeShipInitiativeTotal(actor, combat.id);
    for (const combatant of combatants) {
        await combat.setInitiative(combatant.id, total);
    }
}

export class MgT2Combat extends foundry.documents.Combat {
    async rollInitiative(ids, options={}) {
        const combatantIds = Array.isArray(ids) ? ids : [ids];
        const combatants = combatantIds
            .map(id => this.combatants.get(id))
            .filter(combatant => combatant);
        const travellers = combatants.filter(combatant => combatant.actor?.type === "traveller");
        const ships = combatants.filter(combatant => combatant.actor?.type === "spacecraft");
        const others = combatants.filter(combatant =>
            combatant.actor?.type !== "traveller" && combatant.actor?.type !== "spacecraft");

        if (others.length) {
            await super.rollInitiative(others.map(combatant => combatant.id), options);
        }
        for (const combatant of travellers) {
            await rollTravellerInitiative(this, combatant.actor, [combatant]);
        }
        for (const combatant of ships) {
            await rollShipInitiative(this, combatant.actor, [combatant]);
        }
        return this;
    }
}
