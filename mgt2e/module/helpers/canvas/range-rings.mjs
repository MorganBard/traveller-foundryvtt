import { MGT2 } from "../config.mjs";
import { getHexBand, hexesInSector } from "../naval-maneuver.mjs";

let overlay = null;
let sectorOverlay = null;

function getOverlay() {
    if (!overlay || overlay.destroyed) {
        overlay = new PIXI.Container();
        overlay.name = "mgt2e-range-rings";
        overlay.eventMode = "none";
        canvas.interface.addChild(overlay);
    }
    return overlay;
}

// Separate, independent overlay for the Change Heading dialog's sector-hover highlight, so it
// can be shown/cleared without disturbing the range-band rings (which may or may not be visible
// at the same time, depending on whether a ship token happens to be selected).
function getSectorOverlay() {
    if (!sectorOverlay || sectorOverlay.destroyed) {
        sectorOverlay = new PIXI.Container();
        sectorOverlay.name = "mgt2e-sector-highlight";
        sectorOverlay.eventMode = "none";
        canvas.interface.addChild(sectorOverlay);
    }
    return sectorOverlay;
}

// getAdjacentCubes() does not guarantee its 6 results are in angular (rotational) order - they
// must be sorted before use as a ring-walk basis. The grid is translation-invariant, so it's
// enough to compare each direction's pixel offset against cube (0,0,0)'s own pixel position,
// regardless of where any particular token actually sits on the canvas.
function getSortedDirections() {
    const zero = canvas.grid.cubeToPoint({ q: 0, r: 0, s: 0 });
    const dirs = canvas.grid.getAdjacentCubes({ q: 0, r: 0, s: 0 });
    return dirs
        .map(dir => {
            const point = canvas.grid.cubeToPoint(dir);
            const angle = Math.atan2(point.y - zero.y, point.x - zero.x);
            return { dir, angle };
        })
        .sort((a, b) => a.angle - b.angle)
        .map(entry => entry.dir);
}

function cubeAdd(a, b) {
    return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
}

// All hex cells at exactly `radius` hexes from `center` (the ring, not the filled disk) - the
// standard "walk 6 sides, radius steps each" hex-ring algorithm, using our angularly-sorted
// direction basis so consecutive cells are actually adjacent as we walk around.
function cubeRing(center, radius, directions) {
    if (radius === 0) {
        return [center];
    }
    const results = [];
    let cube = cubeAdd(center, { q: directions[4].q * radius, r: directions[4].r * radius, s: directions[4].s * radius });
    for (let side = 0; side < 6; side++) {
        for (let step = 0; step < radius; step++) {
            results.push(cube);
            cube = cubeAdd(cube, directions[side]);
        }
    }
    return results;
}

export function clearRangeRings() {
    if (overlay && !overlay.destroyed) {
        overlay.removeChildren().forEach(child => child.destroy());
    }
}

export function drawRangeRings(controlledToken) {
    clearRangeRings();

    if (!canvas.grid.isHexagonal || controlledToken?.document?.actor?.type !== "spacecraft") {
        return;
    }

    const layer = getOverlay();
    const originCube = canvas.grid.getCube(controlledToken.center);
    const directions = getSortedDirections();

    let minHex = 0;
    for (const band of MGT2.HEX_RANGE_BANDS) {
        const maxHex = Number.isFinite(band.maxHex) ? band.maxHex : minHex + 4;
        const graphics = new PIXI.Graphics();
        graphics.beginFill(band.color, 0.12);
        for (let radius = minHex; radius <= maxHex; radius++) {
            for (const cube of cubeRing(originCube, radius, directions)) {
                const vertices = canvas.grid.getVertices(cube);
                graphics.drawPolygon(vertices.flatMap(p => [p.x, p.y]));
            }
        }
        graphics.endFill();
        layer.addChild(graphics);

        if (!Number.isFinite(band.maxHex)) {
            break;
        }
        minHex = band.maxHex + 1;
    }

    for (const token of canvas.tokens.placeables) {
        if (token === controlledToken || token.document?.actor?.type !== "spacecraft") {
            continue;
        }
        const hexDistance = canvas.grid.measurePath([controlledToken.center, token.center]).spaces;
        const band = getHexBand(hexDistance);
        const graphics = new PIXI.Graphics();
        const radius = Math.max(token.w, token.h) / 2 + 6;
        graphics.lineStyle(4, band.color, 0.9);
        graphics.drawCircle(token.center.x, token.center.y, radius);
        layer.addChild(graphics);
    }
}

export function clearSectorHighlight() {
    if (sectorOverlay && !sectorOverlay.destroyed) {
        sectorOverlay.removeChildren().forEach(child => child.destroy());
    }
}

// Highlights the hex wedge belonging to one sector (0-5) around a ship token, so a player
// hovering a sector option in the Change Heading dialog can see where it actually points on the
// map. Uses hexesInSector (naval-maneuver.mjs) rather than any local direction math, so the
// highlighted wedge is guaranteed to match the sector actually used by bearing/facing logic.
export function highlightSector(token, sector) {
    clearSectorHighlight();

    if (!token || !canvas.grid.isHexagonal) {
        return;
    }

    const layer = getSectorOverlay();
    const originCube = canvas.grid.getCube(token.center);
    const hexes = hexesInSector(originCube, sector, 6);

    const graphics = new PIXI.Graphics();
    graphics.beginFill(0x00ccff, 0.35);
    for (const cube of hexes) {
        const vertices = canvas.grid.getVertices(cube);
        graphics.drawPolygon(vertices.flatMap(p => [p.x, p.y]));
    }
    graphics.endFill();
    layer.addChild(graphics);
}
