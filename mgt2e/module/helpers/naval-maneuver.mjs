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
// Sorted clockwise starting from whichever direction points closest to straight up ("north" on a
// ground map), so sector 0 is always "up" and sectors 1-5 proceed clockwise from there - not
// whatever arbitrary order Foundry's grid API happens to return.
function cubeDirections() {
    const zero = canvas.grid.cubeToPoint({ q: 0, r: 0, s: 0 });
    const dirs = canvas.grid.getAdjacentCubes({ q: 0, r: 0, s: 0 });
    return dirs
        .map(dir => {
            const point = canvas.grid.cubeToPoint(dir);
            const dx = point.x - zero.x;
            const dy = point.y - zero.y;
            const clockwiseFromNorth = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;
            return { dir, clockwiseFromNorth };
        })
        .sort((a, b) => a.clockwiseFromNorth - b.clockwiseFromNorth)
        .map(entry => entry.dir);
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

// Every hex cube within maxRadius of originCube that classifies as the given sector, using the
// exact same classifyDirectionIndex used everywhere else in this module - so a canvas overlay
// built from this is guaranteed to agree with actual bearing/facing calculations, not just
// visually resemble them. Exported specifically for range-rings.mjs's sector-hover highlight.
export function hexesInSector(originCube, sector, maxRadius) {
    const hexes = [];
    for (let dq = -maxRadius; dq <= maxRadius; dq++) {
        const drMin = Math.max(-maxRadius, -dq - maxRadius);
        const drMax = Math.min(maxRadius, -dq + maxRadius);
        for (let dr = drMin; dr <= drMax; dr++) {
            const ds = -dq - dr;
            const hexLen = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
            if (hexLen === 0 || hexLen > maxRadius) {
                continue;
            }
            if (closestDirectionIndex({ q: dq, r: dr, s: ds }) === sector) {
                hexes.push({ q: originCube.q + dq, r: originCube.r + dr, s: originCube.s + ds });
            }
        }
    }
    return hexes;
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

// Converts a sector index (0-5) into a Foundry token rotation angle (degrees, clockwise from
// north/up - Foundry's own convention), using the exact same unsorted direction basis that
// defines "sector N" everywhere else in this module, so the token's visual facing is guaranteed
// to match the sector actually used for bearing/multiplier calculations.
function sectorAngleDegrees(sector) {
    const zero = canvas.grid.cubeToPoint({ q: 0, r: 0, s: 0 });
    const dir = cubeDirections()[sector];
    const point = canvas.grid.cubeToPoint(dir);
    const dx = point.x - zero.x;
    const dy = point.y - zero.y;
    const degrees = Math.atan2(dx, -dy) * (180 / Math.PI);
    return (degrees + 360) % 360;
}

// Sets a ship's facing directly - free to change each round, no thrust cost, no target needed.
// Also rotates the ship's token(s) on the current scene to visually match, so heading isn't just
// a mechanical flag with no on-map indication.
export async function setShipFacing(actingShip, facing) {
    await actingShip.setFlag("mgt2e-piggy", "facing", facing);

    if (canvas.grid.isHexagonal) {
        const rotation = sectorAngleDegrees(facing);
        const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === actingShip.id);
        for (const token of tokens) {
            await token.document.update({ rotation });
        }
    }

    return { newFacing: facing };
}

// Resolves the bearing of otherShip as seen from fromShip, lazily initialising their pair
// record (via live token geometry) if this is the first time they've been touched.
export async function bearingOfShip(combat, fromShip, otherShip) {
    const { pair } = await getOrInitPair(combat, fromShip, otherShip);
    return bearingFrom(pair, fromShip.id, otherShip.id);
}

// Applies Accelerate/Decelerate: the acting ship spends up to its Thrust rating to change its
// closing speed toward every other ship in the encounter, using whatever heading is CURRENTLY
// set (via setShipFacing) rather than deriving a heading from any specific target. Sector-offset
// multipliers (same/opposite/adjacent/two-off) apply exactly as before.
export async function applyThrust(combat, actingShip, thrust, direction) {
    const baseDelta = (direction === "opening" ? -1 : 1) * thrust;
    const newFacing = parseInt(actingShip.getFlag("mgt2e-piggy", "facing")) || 0;

    // Establish a pair for every other spacecraft in the encounter (not just ones already
    // touched) so nobody is silently skipped just because their pair was never initialised yet.
    const otherActorIds = new Set(
        combat.combatants
            .filter(c => c.actor?.type === "spacecraft" && c.actor.id !== actingShip.id)
            .map(c => c.actor.id)
    );

    const allPairs = foundry.utils.deepClone(combat.getFlag("mgt2e-piggy", "shipPairs") ?? {});
    for (const otherId of otherActorIds) {
        const otherActor = game.actors.get(otherId);
        const key = pairKey(actingShip.id, otherId);
        if (!otherActor || allPairs[key]) {
            continue;
        }
        allPairs[key] = initPairRecord(actingShip, otherActor);
    }

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
