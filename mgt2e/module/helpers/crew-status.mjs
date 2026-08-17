import { lifeSupportStatus } from "./spacecraft/life-support.mjs";

// Healthy verdigris -> near-black, matching the Ship Status board's thematic gradient rather
// than a stock green/red scale. Continuous (not stepped) since STR+DEX+END damage accrues by
// arbitrary amounts, unlike the 0-6 stepped criticals elsewhere.
function healthColor(pct) {
    const t = 1 - Math.max(0, Math.min(100, pct)) / 100;
    const from = [0x6f, 0x96, 0x83];
    const to = [0x12, 0x0a, 0x06];
    const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

// STR/DEX/END are three independent tracks in MGT2 - a character goes Injured/Unconscious/Dead
// off how many tracks have individually bottomed out, not off a combined pool. The percentage
// bar is a rough-and-ready visual (matches the "trending green to black" ask), so the exact
// status label is shown alongside it rather than relying on the bar alone.
function crewHealthInfo(crewActor) {
    const chars = crewActor.system.characteristics ?? {};
    const dmg = crewActor.system.damage ?? {};
    const str = Number(chars.STR?.value ?? 0);
    const dex = Number(chars.DEX?.value ?? 0);
    const end = Number(chars.END?.value ?? 0);
    const dmgStr = Number(dmg.STR?.value ?? 0);
    const dmgDex = Number(dmg.DEX?.value ?? 0);
    const dmgEnd = Number(dmg.END?.value ?? 0);

    const maxTotal = str + dex + end;
    const damageTotal = Math.min(dmgStr, str) + Math.min(dmgDex, dex) + Math.min(dmgEnd, end);
    const pct = maxTotal > 0 ? Math.max(0, Math.round(100 * (1 - damageTotal / maxTotal))) : 100;

    let numAtZero = 0;
    if (dmgStr >= str) numAtZero++;
    if (dmgDex >= dex) numAtZero++;
    if (dmgEnd >= end) numAtZero++;
    const statusLabel = ["Okay", "Injured", "Unconscious", "Dead"][numAtZero];

    return { pct, color: healthColor(pct), statusLabel };
}

// Crew health + life support detail, opened from a ship's Ship Status section. Separate window
// for the same reason Weapons is: real per-crew-member data doesn't belong folded into the main
// board's single "Crew" severity row, which stays as a generic indicator there.
export class MgT2CrewStatusApp extends Application {
    static _openInstances = new Set();

    static refreshAll() {
        for (const instance of this._openInstances) {
            if (instance.rendered) {
                instance.render(false);
            }
        }
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "mgt2e-crew-status",
            classes: ["mgt2e-crew-status"],
            template: "systems/mgt2e-piggy/templates/crew-status.html",
            width: 340,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    constructor(shipActor, options = {}) {
        super(options);
        this.shipActor = shipActor;
        MgT2CrewStatusApp._openInstances.add(this);
    }

    close(options) {
        MgT2CrewStatusApp._openInstances.delete(this);
        return super.close(options);
    }

    get title() {
        return `${this.shipActor?.name ?? "Ship"} - Crew`;
    }

    getData() {
        const crew = Object.keys(this.shipActor.system.crewed?.crew ?? {})
            .map(id => game.actors.get(id))
            .filter(a => a)
            .map(a => ({ id: a.id, name: a.name, ...crewHealthInfo(a) }));

        return { shipActor: this.shipActor, crew, lifeSupport: lifeSupportStatus(this.shipActor) };
    }
}
