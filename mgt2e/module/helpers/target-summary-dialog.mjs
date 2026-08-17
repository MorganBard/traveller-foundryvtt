import { rollSkill } from "./dice-rolls.mjs";
import { getRangeBand } from "./naval-course.mjs";
import { MGT2 } from "./config.mjs";

// House-rule "Target Summary" scan (see MGT2.Settings.DetailedSensorScans) - the Core Rules only
// ever treat sensors as "did you detect the ship," not "tell me everything about it." This is a
// deliberately optional, graduated alternative: a Sensor Ops roll's Effect against a chosen
// target unlocks successively more detail, cached per (scanning ship, target) pair so opening
// the dialog again doesn't force a re-roll.

function sizeClassLabel(dtons) {
    if (dtons < 100) return "Small Craft";
    if (dtons < 1000) return "Light";
    if (dtons < 5000) return "Standard";
    return "Heavy";
}

function hardpointCount(dtons) {
    return Math.max(1, Math.floor(dtons / 100));
}

function hullConditionLabel(actor) {
    const max = Number(actor.system.hits?.max) || 0;
    const damage = Number(actor.system.hits?.damage) || 0;
    if (max <= 0) {
        return "Unknown";
    }
    const pct = 1 - (damage / max);
    if (pct >= 0.9) return "Undamaged";
    if (pct >= 0.6) return "Lightly Damaged";
    if (pct >= 0.3) return "Heavily Damaged";
    return "Critical";
}

function trendLabel(prevBand, currentBand) {
    if (prevBand === null || prevBand === undefined) {
        return null;
    }
    if (currentBand === prevBand) {
        return "Maintaining Distance";
    }
    return currentBand < prevBand ? "Closing" : "Receding";
}

function tierForEffect(effect) {
    if (effect === null || effect === undefined) return 0;
    if (effect < 0) return 1;
    if (effect <= 2) return 2;
    if (effect <= 5) return 3;
    return 4;
}

function weaponLoadout(targetActor) {
    const mounts = targetActor.items.filter(i => i.type === "hardware" && i.system.hardware?.system === "weapon");
    return mounts.map(mount => {
        const weapons = mount.system.hardware.weapons ?? {};
        const names = Object.keys(weapons)
            .map(id => targetActor.items.get(id)?.name)
            .filter(n => n);
        return { mountName: mount.name, weapons: names.length ? names.join(", ") : "Unarmed" };
    });
}

export class MgT2TargetSummaryDialog extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "mgt2e-target-summary",
            classes: ["mgt2e-target-summary"],
            template: "systems/mgt2e-piggy/templates/target-summary-dialog.html",
            width: 380,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    constructor(shipActor, crewActor, options = {}) {
        super(options);
        this.shipActor = shipActor;
        this.crewActor = crewActor;
        if (options.theme === "tactical") {
            this.options.classes.push("tactical");
        }

        this.targets = (game.combat?.combatants ?? [])
            .map(c => c.actor)
            .filter(a => a?.type === "spacecraft" && a.id !== this.shipActor.id);
        this.targetId = this.targets[0]?.id ?? null;
    }

    get title() {
        return `${this.shipActor?.name ?? "Ship"} - Target Summary`;
    }

    _contact(targetId) {
        const contacts = this.shipActor.getFlag("mgt2e-piggy", "sensorContacts") ?? {};
        return contacts[targetId] ?? null;
    }

    _buildTargetData(targetActor) {
        const band = getRangeBand(game.combat, this.shipActor.id, targetActor.id);
        const bandLabel = MGT2.RANGE_BANDS[band]?.label ?? "Unknown";
        const contact = this._contact(targetActor.id);
        const tier = tierForEffect(contact?.effect);
        const transponderActive = targetActor.system.spacecraft?.computer?.transponder === "ACTIVE";

        const data = {
            id: targetActor.id,
            bandLabel,
            tier,
            scanned: tier > 0,
            failed: tier === 1,
            name: transponderActive ? targetActor.name : "Unidentified Contact"
        };

        if (tier >= 2) {
            data.sizeClass = sizeClassLabel(targetActor.system.spacecraft?.dtons ?? 0);
            data.tonnage = targetActor.system.spacecraft?.dtons ?? "Unknown";
            data.hullConfig = targetActor.system.spacecraft?.configuration ?? "Unknown";
            data.trend = trendLabel(contact?.band, band);
        }
        if (tier >= 3) {
            data.hardpoints = hardpointCount(targetActor.system.spacecraft?.dtons ?? 0);
            data.committedSpeed = targetActor.getFlag("mgt2e-piggy", "navSpeed") ?? 0;
            if (transponderActive) {
                data.name = targetActor.name;
            } else {
                data.name = "Unidentified Contact (transponder silent)";
            }
        }
        if (tier >= 4) {
            data.weaponLoadout = weaponLoadout(targetActor);
            const navTargetId = targetActor.getFlag("mgt2e-piggy", "navTarget");
            data.courseTarget = navTargetId ? (game.actors.get(navTargetId)?.name ?? "Unknown") : "Holding position";
            data.jumpCapable = (parseInt(targetActor.system.spacecraft?.jdrive) || 0) > 0;
            data.hullCondition = hullConditionLabel(targetActor);
        }

        return data;
    }

    getData() {
        const targetList = {};
        for (const t of this.targets) {
            const band = getRangeBand(game.combat, this.shipActor.id, t.id);
            const transponderActive = t.system.spacecraft?.computer?.transponder === "ACTIVE";
            const label = transponderActive ? t.name : "Unidentified Contact";
            targetList[t.id] = `${label} (${MGT2.RANGE_BANDS[band]?.label ?? "Unknown"})`;
        }

        const targetActor = this.targetId ? game.actors.get(this.targetId) : null;

        return {
            shipActor: this.shipActor,
            crewActor: this.crewActor,
            hasTargets: this.targets.length > 0,
            targetList,
            targetSelected: this.targetId,
            target: targetActor ? this._buildTargetData(targetActor) : null
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".target-summary-select").on("change", ev => {
            this.targetId = ev.currentTarget.value;
            this.render(false);
        });

        html.find(".scan-target").on("click", async () => {
            const targetActor = game.actors.get(this.targetId);
            if (!targetActor) {
                return;
            }
            const band = getRangeBand(game.combat, this.shipActor.id, targetActor.id);
            const rangeKey = MGT2.RANGE_BANDS[band]?.key ?? "adjacent";
            const rangeDM = parseInt(MGT2.SPACE_RANGES[rangeKey]?.dm) || 0;

            const result = await rollSkill(this.crewActor, "electronics.sensors", {
                dm: rangeDM,
                difficulty: 8,
                text: `Scan ${targetActor.name}`
            });
            const effect = result - 8;

            const contacts = foundry.utils.deepClone(this.shipActor.getFlag("mgt2e-piggy", "sensorContacts") ?? {});
            contacts[targetActor.id] = { effect, band };
            await this.shipActor.setFlag("mgt2e-piggy", "sensorContacts", contacts);

            this.render(false);
        });
    }
}
