/**
 * Life support failure countdown - see MGT2.SPACECRAFT_CRITICALS.crew, levels 2/4/6.
 *
 * Deliberately NOT automated past "life support has failed": whether the crew makes it to a
 * vacc suit, life pod, or the ship's boat in time - and what happens to whoever doesn't - is a
 * GM table call, not something this system rolls for. The countdown exists for tension, not to
 * replace the GM.
 */

async function failLifeSupport(actor) {
    await actor.unsetFlag("mgt2e-piggy", "lifeSupportFailAt");
    await actor.unsetFlag("mgt2e-piggy", "lifeSupportRoundsRemaining");
    await actor.setFlag("mgt2e-piggy", "lifeSupportFailed", true);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<strong>${actor.name}</strong>: LIFE SUPPORT HAS FAILED. The air is turning foul ` +
            `and the cold is setting in - anyone aboard without a vacc suit, life pod, or other ` +
            `shelter has only a short time to reach one.`
    });
}

export async function startLifeSupportHourCountdown(actor, level) {
    const roll = await new Roll("1D6", null).evaluate();
    const hours = roll.total;
    await actor.setFlag("mgt2e-piggy", "lifeSupportFailAt", game.time.worldTime + hours * 3600);
    await actor.setFlag("mgt2e-piggy", "damage_lifeSupport", true);
    await actor.setFlag("mgt2e-piggy", "damageSev_lifeSupport", level);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<strong>${actor.name}</strong>: Life support is failing. Estimated ${hours} hour(s) ` +
            `before it gives out entirely.`
    });
}

export async function startLifeSupportRoundCountdown(actor, level) {
    const roll = await new Roll("1D6", null).evaluate();
    const rounds = roll.total;
    await actor.setFlag("mgt2e-piggy", "lifeSupportRoundsRemaining", rounds);
    await actor.setFlag("mgt2e-piggy", "damage_lifeSupport", true);
    await actor.setFlag("mgt2e-piggy", "damageSev_lifeSupport", level);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<strong>${actor.name}</strong>: Life support is failing fast. ${rounds} round(s) remaining.`
    });
}

export async function failLifeSupportImmediately(actor, level) {
    await actor.setFlag("mgt2e-piggy", "damage_lifeSupport", true);
    await actor.setFlag("mgt2e-piggy", "damageSev_lifeSupport", level);
    await failLifeSupport(actor);
}

// combatRound hook - mirrors tickSelfDestruct in mgt2.mjs.
export async function tickLifeSupportRounds(combat) {
    for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (actor?.type !== "spacecraft") {
            continue;
        }
        const remaining = actor.getFlag("mgt2e-piggy", "lifeSupportRoundsRemaining");
        if (remaining === undefined || remaining === null) {
            continue;
        }
        if (remaining <= 1) {
            await failLifeSupport(actor);
        } else {
            await actor.setFlag("mgt2e-piggy", "lifeSupportRoundsRemaining", remaining - 1);
        }
    }
}

// updateWorldTime hook - the hour-based countdown runs on the real game clock, independent of
// combat, since RAW life support failure on this timescale is meant to catch up with the crew
// after the fight is over, not during it.
export async function checkLifeSupportHourDeadlines() {
    for (const actor of game.actors) {
        if (actor.type !== "spacecraft") {
            continue;
        }
        const failAt = actor.getFlag("mgt2e-piggy", "lifeSupportFailAt");
        if (failAt !== undefined && failAt !== null && game.time.worldTime >= failAt) {
            await failLifeSupport(actor);
        }
    }
}

// Called from the repair dialog on a successful Engineer roll against "lifeSupport" - clears
// both the countdown/failed state and the damage_/damageSev_ flags the repair dialog itself uses.
export async function repairLifeSupport(actor) {
    await actor.unsetFlag("mgt2e-piggy", "lifeSupportFailAt");
    await actor.unsetFlag("mgt2e-piggy", "lifeSupportRoundsRemaining");
    await actor.unsetFlag("mgt2e-piggy", "lifeSupportFailed");
}

export function lifeSupportStatus(actor) {
    if (actor.getFlag("mgt2e-piggy", "lifeSupportFailed")) {
        return { state: "failed", label: "LIFE SUPPORT FAILED" };
    }

    const roundsRemaining = actor.getFlag("mgt2e-piggy", "lifeSupportRoundsRemaining");
    if (roundsRemaining !== undefined && roundsRemaining !== null) {
        return { state: "rounds", label: `Failing - ${roundsRemaining} round(s) remaining` };
    }

    const failAt = actor.getFlag("mgt2e-piggy", "lifeSupportFailAt");
    if (failAt !== undefined && failAt !== null) {
        const hoursLeft = Math.max(0, Math.ceil((failAt - game.time.worldTime) / 3600));
        const calendaria = game.modules.get("calendaria");
        if (calendaria?.active && calendaria.api?.timestampToDate) {
            const date = calendaria.api.timestampToDate(failAt);
            return { state: "hours", label: `Failing - due ~${date.hour}:${String(date.minute).padStart(2, "0")}, Day ${date.day}` };
        }
        return { state: "hours", label: `Failing - ~${hoursLeft} hour(s) remaining` };
    }

    return { state: "nominal", label: "Nominal" };
}
