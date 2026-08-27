import { MGT2 } from "./config.mjs";

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

// House-rule resolution (default): the net Thrust contribution applies as a flat 1-band-per-point
// shift, resolved instantly this round, clamped to the ladder ends. No cost table, no banking.
function resolveHouseRuleBandShift(current, netClosing) {
    return { band: Math.min(6, Math.max(0, current.band - netClosing)), progress: 0 };
}

// RAW resolution (Core Rulebook "Ship Movement" table): the net Thrust contribution banks as
// signed progress against the pair's current band rather than resolving instantly - a ship can
// spend Thrust over multiple rounds to close or open a category. Each step's cost is looked up
// fresh from MGT2.RANGE_BAND_THRUST_COST for whatever band the pair is AT when that step is taken
// (cost varies a lot by band), so a Thrust-rich ship at cheap short range can cascade through
// several steps in one round, while a Thrust-poor ship at expensive long range grinds for several
// rounds on the same banked total before the band actually ticks over. Progress banked past the
// end of the ladder (already Adjacent and still "closing", or already Distant and still "opening")
// is discarded, not held indefinitely.
function resolveRawBandShift(current, netClosing) {
    let band = current.band;
    let progress = (current.progress ?? 0) + netClosing;

    while (progress !== 0) {
        const direction = progress > 0 ? -1 : 1; // positive progress closes - band moves toward 0
        const nextBand = band + direction;
        if (nextBand < 0 || nextBand > 6) {
            progress = 0;
            break;
        }
        const cost = MGT2.RANGE_BAND_THRUST_COST[band];
        if (Math.abs(progress) < cost) {
            break;
        }
        band = nextBand;
        progress += direction === -1 ? -cost : cost;
    }

    return { band, progress };
}

// Round-boundary resolution: for every pair of spacecraft in the encounter, each ship contributes
// a signed value to that pair - +navSpeed if the pair's OTHER ship is this ship's current
// navTarget (closing), or -navSpeed otherwise (opening - automatic, since a ship can only be
// oriented toward one target at a time, per the "closing on one target means opening on
// everyone else" design). The two ships' contributions are summed to get this pair's net Thrust
// contribution for the round, then resolved per the "navalRangeBandModel" world setting - either
// the flat house-rule shift or the RAW banked-progress model. Runs once per round (see mgt2.mjs's
// combatRound hook), not once per combatant.
export async function resolveRangeBandsForRound(combat) {
    const ships = spacecraftActors(combat);
    const bands = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "rangeBands") ?? {});
    const rawModel = game.settings.get("mgt2e-piggy", "navalRangeBandModel") === "raw";

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
            bands[key] = rawModel
                ? resolveRawBandShift(current, netClosing)
                : resolveHouseRuleBandShift(current, netClosing);
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
            bands[key] = { band: startingBand, progress: 0 };
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

// Reads a pair's banked Thrust progress toward its next Range Band shift (RAW model only - always
// 0 under the house-rule model, since that resolves instantly with nothing left to bank) and the
// Thrust cost of that next shift, or null if the pair has no baseline yet.
export function getRangeBandProgress(combat, shipAId, shipBId) {
    const bands = combat.getFlag("mgt2e-piggy", "rangeBands") ?? {};
    const entry = bands[pairKey(shipAId, shipBId)];
    if (!entry) {
        return null;
    }
    return {
        progress: Math.abs(entry.progress ?? 0),
        cost: MGT2.RANGE_BAND_THRUST_COST[entry.band]
    };
}
