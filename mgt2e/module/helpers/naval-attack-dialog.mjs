import { rollSpaceAttack } from "./dice-rolls.mjs";
import { launchMissiles } from "./spacecraft/spacecraft-utils.mjs";
import { getRangeBand } from "./naval-course.mjs";
import { MGT2 } from "./config.mjs";

// Range-Band-aware replacement for MgT2SpacecraftAttackDialog, used only by the Gunner console
// and the GM panel - both tokenless naval combat surfaces. Deliberately NOT a replacement for
// MgT2SpacecraftAttackDialog itself, which swarm.mjs still uses for its own (token-based) combat
// model; that dialog's canvas-token targeting is correct there, just not here.
//
// The actual roll math (skill DM, range DM, evasion, missile/squadron handling, mount
// multipliers) is entirely unchanged - this only replaces how range and target get picked,
// swapping canvas token distance for the already-tracked per-pair Range Band.
export class MgT2NavalAttackDialog extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "mgt2e-naval-attack",
            classes: ["mgt2e-naval-attack"],
            template: "systems/mgt2e-piggy/templates/naval-attack-dialog.html",
            width: 360,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    constructor(shipActor, gunnerActor, mountItem, attackOptions = {}) {
        super();
        this.shipActor = shipActor;
        this.gunner = gunnerActor;
        this.mount = mountItem;
        this.dm = isNaN(attackOptions.dm) ? 0 : parseInt(attackOptions.dm);

        this.weaponSelect = {};
        this.weaponSelected = null;
        const weapons = this.mount?.system?.hardware?.weapons ?? {};
        for (const wpnId in weapons) {
            const wpnItem = this.shipActor.items.get(wpnId);
            if (!wpnItem) {
                continue;
            }
            if (!this.weaponSelected) {
                this.weaponSelected = wpnId;
            }
            const qty = weapons[wpnId].quantity;
            this.weaponSelect[wpnId] = qty > 1 ? `${wpnItem.name} x${qty}` : wpnItem.name;
        }

        this.targets = (game.combat?.combatants ?? [])
            .map(c => c.actor)
            .filter(a => a?.type === "spacecraft" && a.id !== this.shipActor.id);
        this.targetId = this.targets[0]?.id ?? null;
        this.range = this._rangeForTarget(this.targetId);
    }

    get title() {
        return `${this.shipActor?.name ?? "Ship"} firing ${this.mount?.name ?? "weapon"}`;
    }

    _rangeForTarget(targetId) {
        if (!targetId || !game.combat) {
            return "adjacent";
        }
        const band = getRangeBand(game.combat, this.shipActor.id, targetId);
        return MGT2.RANGE_BANDS[band]?.key ?? "adjacent";
    }

    getData() {
        const weaponItem = this.shipActor.items.get(this.weaponSelected);
        const cha = weaponItem?.system?.weapon?.characteristic;
        const chaDM = cha && this.gunner.system.characteristics[cha] ? this.gunner.system.characteristics[cha].dm : 0;

        const ranges = {};
        for (const r in MGT2.SPACE_RANGES) {
            ranges[r] = `${game.i18n.localize("MGT2.Item.SpaceRange." + r)} (${MGT2.SPACE_RANGES[r].dm})`;
        }

        const targetList = {};
        for (const t of this.targets) {
            const band = getRangeBand(game.combat, this.shipActor.id, t.id);
            targetList[t.id] = `${t.name} (${MGT2.RANGE_BANDS[band]?.label ?? "Unknown"})`;
        }

        return {
            shipActor: this.shipActor,
            gunner: this.gunner,
            mount: this.mount,
            weaponSelect: this.weaponSelect,
            weaponSelected: this.weaponSelected,
            weaponItem,
            dm: this.dm,
            ranges,
            range: this.range,
            hasTargets: this.targets.length > 0,
            targetList,
            targetSelected: this.targetId,
            rollTypes: {
                normal: game.i18n.localize("MGT2.TravellerSheet.Normal"),
                boon: game.i18n.localize("MGT2.TravellerSheet.Boon"),
                bane: game.i18n.localize("MGT2.TravellerSheet.Bane")
            },
            gunnerChaLabel: chaDM ? `${cha} ${chaDM}` : "",
            gunnerSkillLabel: weaponItem ? this.gunner.getSkillLabel(weaponItem.system.weapon.skill, true) : ""
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".attackDialogWeapon").on("change", ev => {
            this.weaponSelected = ev.currentTarget.value;
            this.render(false);
        });

        html.find(".attackDialogTargets").on("change", ev => {
            this.targetId = ev.currentTarget.value;
            this.range = this._rangeForTarget(this.targetId);
            this.render(false);
        });

        html.find(".attackRoll").on("click", async ev => {
            ev.preventDefault();
            await this._rollAttack(html);
        });
    }

    async _rollAttack(html) {
        const weaponItem = this.shipActor.items.get(this.weaponSelected);
        if (!weaponItem) {
            ui.notifications.error("No weapon selected.");
            return;
        }

        const dm = parseInt(html.find(".skillDialogDM")[0].value) || 0;
        const rollType = html.find(".skillDialogRollType")[0].value;
        const range = html.find(".attackDialogRange")[0].value;
        const rangeDM = parseInt(MGT2.SPACE_RANGES[range]?.dm) || 0;
        const defenderShip = this.targetId ? game.actors.get(this.targetId) : null;

        const options = {
            dm,
            skill: 0,
            range,
            rangeDM,
            boon: rollType,
            defenderShip
        };

        const weapons = this.mount.system.hardware.weapons;
        if (weapons[weaponItem.id]?.quantity > 1) {
            options.quantity = weapons[weaponItem.id].quantity;
        }

        if (weaponItem.hasTrait("missile")) {
            await launchMissiles(this.shipActor, weaponItem, options);
        } else {
            await rollSpaceAttack(this.shipActor, this.gunner, weaponItem, options);
        }

        this.close();
    }
}
