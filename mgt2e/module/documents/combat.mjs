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
    const tacticsDM = actor.getFlag("mgt2e-piggy", "initTacticsDM");
    const tacticsName = actor.getFlag("mgt2e-piggy", "initTacticsName");

    for (const combatant of combatants) {
        if (tacticsDM !== undefined && tacticsDM !== null) {
            // The Captain's "Combat Tactics" role action already rolled this round's
            // initiative - reuse it rather than rolling again.
            await combat.setInitiative(combatant.id, tacticsDM);
            const chatData = {
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({actor}),
                content: `${actor.name} uses its already-rolled Tactics (Naval) initiative` +
                    (tacticsName ? ` (rolled by ${tacticsName})` : "") + `: ${tacticsDM}`
            };
            await ChatMessage.create(chatData);
            continue;
        }

        const roll = await new Roll("2D6").evaluate();
        const dice = roll.dice.flatMap(die => die.results.map(result => ({
            result: result.result,
            cssClass: result.result === 6 ? "max" : (result.result === 1 ? "min" : "")
        })));
        const content = await renderTemplate(
            "systems/mgt2e-piggy/templates/chat/initiative-roll.html",
            {
                actor,
                dice,
                statName: "Tactics (Naval) - not rolled",
                statModifier: 0,
                total: roll.total,
                effect: roll.total
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
        await combat.setInitiative(combatant.id, roll.total);
        ui.notifications.warn(
            `${actor.name} rolled a flat initiative - have the Captain use "Combat Tactics" for a proper roll.`
        );
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
