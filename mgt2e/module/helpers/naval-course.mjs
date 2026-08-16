// Canonical, order-independent key for a ship pair's stored Range Band state.
export function pairKey(idA, idB) {
    return [idA, idB].sort().join(":");
}

// Sets a ship's course for the round: which other ship it's oriented toward (navTarget, persists
// until deliberately changed - "more of a heading control than a speed control") and how much
// speed it's committing (navSpeed, 0 to the ship's Thrust rating, no acceleration/momentum carried
// between rounds - a deliberate simplification). Also immediately sets thrustSpentThisRound to
// match, since Evasive Action's unspent-Thrust calculation (crew-actions.mjs's "evade" special)
// needs to see this the instant the pilot has acted, not deferred to round-end. All three flags
// are written in a single actor update rather than three separate setFlag calls.
export async function setCourse(shipActor, navTargetId, navSpeed) {
    await shipActor.update({
        "flags.mgt2e-piggy.navTarget": navTargetId ?? null,
        "flags.mgt2e-piggy.navSpeed": navSpeed,
        "flags.mgt2e-piggy.thrustSpentThisRound": navSpeed
    });
    return { navTarget: navTargetId ?? null, navSpeed };
}

// Every spacecraft actor currently in the combat.
function spacecraftActors(combat) {
    return combat.combatants
        .map(c => c.actor)
        .filter(actor => actor?.type === "spacecraft");
}

// Round-boundary resolution: for every pair of spacecraft in the encounter, each ship contributes
// a signed value to that pair - +navSpeed if the pair's OTHER ship is this ship's current
// navTarget (closing), or -navSpeed otherwise (opening - automatic, since a ship can only be
// oriented toward one target at a time, per the "closing on one target means opening on
// everyone else" design). The two ships' contributions are summed to get the net Range Band
// shift for that pair this round, clamped to the 0 (Adjacent) - 6 (Distant) ladder. Runs once per
// round (see mgt2.mjs's combatRound hook), not once per combatant.
export async function resolveRangeBandsForRound(combat) {
    const ships = spacecraftActors(combat);
    const bands = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "rangeBands") ?? {});

    for (let i = 0; i < ships.length; i++) {
        for (let j = i + 1; j < ships.length; j++) {
            const shipA = ships[i];
            const shipB = ships[j];
            const key = pairKey(shipA.id, shipB.id);
            const current = bands[key];
            if (!current) {
                // No baseline yet for this pair (e.g. a ship joined mid-encounter) - nothing to
                // resolve against, skip rather than guess a starting band.
                continue;
            }

            const speedA = parseInt(shipA.getFlag("mgt2e-piggy", "navSpeed")) || 0;
            const targetA = shipA.getFlag("mgt2e-piggy", "navTarget");
            const contributionA = (targetA === shipB.id) ? speedA : -speedA;

            const speedB = parseInt(shipB.getFlag("mgt2e-piggy", "navSpeed")) || 0;
            const targetB = shipB.getFlag("mgt2e-piggy", "navTarget");
            const contributionB = (targetB === shipA.id) ? speedB : -speedB;

            const netClosing = contributionA + contributionB;
            bands[key] = { band: Math.min(6, Math.max(0, current.band - netClosing)) };
        }
    }

    await combat.setFlag("mgt2e-piggy", "rangeBands", bands);
}

// Sets every pair among the combat's current spacecraft combatants to the same starting Range
// Band - called once by the Start Naval Encounter dialog. RAW itself suggests most encounters
// begin at Very Long or Distant range.
export async function initRangeBandsForEncounter(combat, startingBand) {
    const ships = spacecraftActors(combat);
    const bands = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "rangeBands") ?? {});

    for (let i = 0; i < ships.length; i++) {
        for (let j = i + 1; j < ships.length; j++) {
            const key = pairKey(ships[i].id, ships[j].id);
            bands[key] = { band: startingBand };
        }
    }

    await combat.setFlag("mgt2e-piggy", "rangeBands", bands);
}

// Reads the current Range Band (0-6) between two ships, or null if the pair has no baseline yet.
export function getRangeBand(combat, shipAId, shipBId) {
    const bands = combat.getFlag("mgt2e-piggy", "rangeBands") ?? {};
    const entry = bands[pairKey(shipAId, shipBId)];
    return entry ? entry.band : null;
}
