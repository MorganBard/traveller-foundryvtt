import { MGT2 } from "./config.mjs";

// Canonical, order-independent key for a ship pair's stored maneuver state.
export function pairKey(idA, idB) {
    return [idA, idB].sort().join(":");
}

// Look up which virtual hex-distance range band a given hex distance falls into.
export function getHexBand(hexDistance) {
    return MGT2.HEX_RANGE_BANDS.find(b => hexDistance <= b.maxHex) ?? MGT2.HEX_RANGE_BANDS[MGT2.HEX_RANGE_BANDS.length - 1];
}

// Live unit vectors for the 6 hex neighbour directions, read from Foundry's own grid API rather
// than hardcoded - keeps this correct regardless of the scene's hex orientation (odd-q, even-r...).
function cubeDirections() {
    return canvas.grid.getAdjacentCubes({ q: 0, r: 0, s: 0 });
}

// Which of the 6 directions a cube-coordinate offset most closely points toward.
function closestDirectionIndex(diff) {
    const hexLen = (Math.abs(diff.q) + Math.abs(diff.r) + Math.abs(diff.s)) / 2;
    if (hexLen === 0) {
        return 0;
    }
    const normalized = { q: diff.q / hexLen, r: diff.r / hexLen, s: diff.s / hexLen };
    const dirs = cubeDirections();
    let bestIndex = 0;
    let bestDist = Infinity;
    dirs.forEach((dir, index) => {
        const dist = (dir.q - normalized.q) ** 2 + (dir.r - normalized.r) ** 2 + (dir.s - normalized.s) ** 2;
        if (dist < bestDist) {
            bestDist = dist;
            bestIndex = index;
        }
    });
    return bestIndex;
}

// Bearing (0-5) of tokenB as seen from tokenA, using live token positions - only used once,
// at pair initialisation, per the "sectors are fixed at encounter start" design.
export function computeBearing(tokenA, tokenB) {
    const cubeA = canvas.grid.getCube(tokenA.center);
    const cubeB = canvas.grid.getCube(tokenB.center);
    const diff = { q: cubeB.q - cubeA.q, r: cubeB.r - cubeA.r, s: cubeB.s - cubeA.s };
    return closestDirectionIndex(diff);
}

// The stored pair always records bearing/facing relative to whichever actor id sorts first,
// to avoid "A"/"B" ambiguity depending on call-argument order. This resolves the bearing of
// otherId as seen from fromId.
export function bearingFrom(pair, fromId, otherId) {
    const firstId = [fromId, otherId].sort()[0];
    return fromId === firstId ? pair.bearingFromFirst : (pair.bearingFromFirst + 3) % 6;
}

// Computes a fresh pair record from live token geometry - the one place real geometry legitimately
// matters, per the "bearing fixed once at encounter start" design. Does not persist anything.
function initPairRecord(shipA, shipB) {
    const tokenA = canvas.tokens.placeables.find(t => t.actor?.id === shipA.id);
    const tokenB = canvas.tokens.placeables.find(t => t.actor?.id === shipB.id);

    const firstId = [shipA.id, shipB.id].sort()[0];
    const firstToken = shipA.id === firstId ? tokenA : tokenB;
    const secondToken = shipA.id === firstId ? tokenB : tokenA;

    let bearingFromFirst = 0;
    let hexDistance = 0;
    if (firstToken && secondToken) {
        bearingFromFirst = computeBearing(firstToken, secondToken);
        hexDistance = canvas.grid.measurePath([firstToken.center, secondToken.center]).spaces;
    }

    return { hexDistance, closingSpeed: 0, bearingFromFirst };
}

// Fetches (lazily initialising and persisting if needed) the stored maneuver state between two
// ships in a combat. For touching several pairs at once without a write per pair, see applyManeuver.
export async function getOrInitPair(combat, shipA, shipB) {
    const key = pairKey(shipA.id, shipB.id);
    const pairs = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "shipPairs") ?? {});
    if (pairs[key]) {
        return { key, pair: pairs[key], allPairs: pairs };
    }

    pairs[key] = initPairRecord(shipA, shipB);
    await combat.setFlag("mgt2e-piggy", "shipPairs", pairs);
    return { key, pair: pairs[key], allPairs: pairs };
}

// Reads the tunable partial-effect multiplier for a given sector offset (0=same, 1=adjacent,
// 2=two sectors off, 3=opposite). These are explicitly house-rule tunables, not derived values.
export function getSectorMultiplier(offset) {
    if (offset === 0) {
        return 1;
    }
    if (offset === 3) {
        return -1;
    }
    if (offset === 1) {
        return game.settings.get("mgt2e-piggy", "maneuverAdjacentSectorMultiplier");
    }
    return game.settings.get("mgt2e-piggy", "maneuverTwoOffSectorMultiplier");
}

// Applies a Maneuver action: acting ship declares closing on/opening from target ship, spending
// up to its Thrust rating. Also applies the same declared thrust to every other ship the acting
// ship has an established pair with, scaled by the sector-offset multiplier.
export async function applyManeuver(combat, actingShip, targetShip, thrust, direction) {
    const baseDelta = (direction === "opening" ? -1 : 1) * thrust;

    // Establish a pair for every other spacecraft in the encounter (not just ones already
    // touched) so nobody is silently skipped just because their pair was never initialised yet.
    const otherActorIds = new Set(
        combat.combatants
            .filter(c => c.actor?.type === "spacecraft" && c.actor.id !== actingShip.id)
            .map(c => c.actor.id)
    );
    otherActorIds.add(targetShip.id);

    const allPairs = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "shipPairs") ?? {});
    for (const otherId of otherActorIds) {
        const otherActor = game.actors.get(otherId);
        const key = pairKey(actingShip.id, otherId);
        if (!otherActor || allPairs[key]) {
            continue;
        }
        allPairs[key] = initPairRecord(actingShip, otherActor);
    }

    const targetPair = allPairs[pairKey(actingShip.id, targetShip.id)];
    const newFacing = bearingFrom(targetPair, actingShip.id, targetShip.id);
    await actingShip.setFlag("mgt2e-piggy", "facing", newFacing);
    // Groundwork for a future Evasive Action implementation, which needs to know how much
    // Thrust a ship has left unspent this round - not read/enforced by anything yet.
    await actingShip.setFlag("mgt2e-piggy", "thrustSpentThisRound", thrust);

    const changes = [];
    for (const otherId of otherActorIds) {
        const key = pairKey(actingShip.id, otherId);
        const pair = allPairs[key];
        if (!pair) {
            continue;
        }
        const otherBearing = bearingFrom(pair, actingShip.id, otherId);
        const offset = Math.min(
            (otherBearing - newFacing + 6) % 6,
            (newFacing - otherBearing + 6) % 6
        );
        const multiplier = getSectorMultiplier(offset);
        const delta = baseDelta * multiplier;
        const oldSpeed = pair.closingSpeed;
        pair.closingSpeed = oldSpeed + delta;
        changes.push({
            actorId: otherId,
            offset,
            multiplier,
            delta,
            oldSpeed,
            newSpeed: pair.closingSpeed
        });
    }

    await combat.setFlag("mgt2e-piggy", "shipPairs", allPairs);
    return { newFacing, changes };
}

// End-of-round resolution: applies each pair's current closing speed to its stored hex distance.
// Runs once per pair (not once per combatant) to avoid double-processing.
export async function resolveShipPairsForRound(combat) {
    const pairs = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "shipPairs") ?? {});
    for (const key of Object.keys(pairs)) {
        const pair = pairs[key];
        pair.hexDistance = Math.max(0, pair.hexDistance - pair.closingSpeed);
    }
    await combat.setFlag("mgt2e-piggy", "shipPairs", pairs);
}
