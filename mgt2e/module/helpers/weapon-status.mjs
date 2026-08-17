import { MgT2Item } from "../documents/item.mjs";

// A weapon mount's system.status is a plain DAMAGED/DESTROYED/unset field (see
// spacecraft/criticals.mjs's applyWeaponCritical) - not the 0-6 severity scale the other
// subsystems use, since RAW only ever knocks an individual mount out or destroys it outright.
function mountStatusInfo(status) {
    if (status === MgT2Item.DESTROYED) {
        return { label: "Destroyed", cls: "destroyed" };
    }
    if (status === MgT2Item.DAMAGED) {
        return { label: "Disabled", cls: "disabled" };
    }
    return { label: "Operational", cls: "operational" };
}

// Per-mount weapon status, opened from a ship's Ship Status section. Separate from that section
// because a large ship can carry far more mounts than fit sanely in one summary list (an 800-ton
// Merc Cruiser can run to eight or more).
export class MgT2WeaponStatusApp extends Application {
    static _openInstances = new Set();

    static refreshAllForActor(actorId) {
        for (const instance of this._openInstances) {
            if (instance.rendered && instance.shipActor?.id === actorId) {
                instance.render(false);
            }
        }
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "mgt2e-weapon-status",
            classes: ["mgt2e-weapon-status"],
            template: "systems/mgt2e-piggy/templates/weapon-status.html",
            width: 340,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    constructor(shipActor, options = {}) {
        super(options);
        this.shipActor = shipActor;
        MgT2WeaponStatusApp._openInstances.add(this);
    }

    close(options) {
        MgT2WeaponStatusApp._openInstances.delete(this);
        return super.close(options);
    }

    get title() {
        return `${this.shipActor?.name ?? "Ship"} - Weapons`;
    }

    getData() {
        const mounts = this.shipActor.items
            .filter(i => i.type === "hardware" && i.system.hardware?.system === "weapon")
            .map(i => ({ id: i.id, name: i.name, ...mountStatusInfo(i.system.status) }));

        return { shipActor: this.shipActor, mounts };
    }
}
