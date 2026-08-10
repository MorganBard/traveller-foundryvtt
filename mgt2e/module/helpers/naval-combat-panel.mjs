import { runCrewAction } from "./crew-actions.mjs";
import { MgT2SpacecraftAttackDialog } from "./spacecraft-attack-dialog.mjs";

// Combat-relevant "special" actions surfaced on the GM panel. Deliberately excludes
// initiative-rolling actions (pilot/tacticsInit - normally a start-of-encounter action, awkward
// mid-turn), improveInit (still an unimplemented stub), and maneuverClose/maneuverOpen (their
// Foundry-targeting requirement doesn't fit a floating panel as well as standalone
// Accelerate/Decelerate + Change Heading do).
const COMBAT_PANEL_SPECIALS = new Set(["evade", "repair", "changeHeading", "accelerate", "decelerate"]);

// GM-facing, single (not per-crew-role) panel that tracks whichever ship is currently active in
// the combat tracker and exposes its combat-relevant actions in one place. Singleton - only one
// instance is ever open at a time. No existing precedent in this codebase for a persistent,
// hook-refreshed Application (every other one is a one-shot dialog) - this uses the standard
// Foundry technique of calling render(false) from hooks registered once in mgt2.mjs.
export class MgT2NavalCombatPanel extends Application {
    static _instance = null;

    static show() {
        if (!this._instance) {
            this._instance = new MgT2NavalCombatPanel();
        }
        this._instance.render(true, { focus: true });
    }

    static toggle() {
        if (this._instance?.rendered) {
            this._instance.close();
        } else {
            this.show();
        }
    }

    static refresh() {
        if (this._instance?.rendered) {
            this._instance.render(false);
        }
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "mgt2e-naval-combat-panel",
            template: "systems/mgt2e-piggy/templates/naval-combat-panel.html",
            title: "Naval Combat Control",
            width: 360,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    close(options) {
        MgT2NavalCombatPanel._instance = null;
        return super.close(options);
    }

    getData() {
        const combat = game.combat;
        const combatant = combat?.combatant;
        const shipActor = combatant?.actor?.type === "spacecraft" ? combatant.actor : null;

        if (!shipActor) {
            return { hasActiveShip: false, combatActive: !!combat };
        }

        return {
            hasActiveShip: true,
            ship: shipActor,
            facing: parseInt(shipActor.getFlag("mgt2e-piggy", "facing")) || 0,
            weaponActions: this._buildWeaponActions(shipActor),
            specialActions: this._buildSpecialActions(shipActor)
        };
    }

    // Every role id currently crewed (assigned to some crew member) on this ship.
    _crewedRoleIds(shipActor) {
        const roleIds = new Set();
        const crewed = shipActor.system.crewed?.crew ?? {};
        for (const actorId in crewed) {
            for (const roleId in crewed[actorId]) {
                if (crewed[actorId][roleId]?.assigned) {
                    roleIds.add(roleId);
                }
            }
        }
        return roleIds;
    }

    // Which crew member (if any) is currently assigned to a given role.
    _crewedActorIdFor(shipActor, roleId) {
        const crewed = shipActor.system.crewed?.crew ?? {};
        for (const actorId in crewed) {
            if (crewed[actorId][roleId]?.assigned) {
                return actorId;
            }
        }
        return null;
    }

    // One Attack button per weapon-carrying hardware mount, not per role - a ship with multiple
    // mounts gets multiple independent attack triggers. Gunner is resolved from whichever crewed
    // role has a "weapon" action bound to this mount's weapon; disabled (not omitted) if none.
    _buildWeaponActions(shipActor) {
        const roleIds = this._crewedRoleIds(shipActor);
        const actions = [];
        for (const item of shipActor.items) {
            if (item.type !== "hardware" || item.system.hardware?.system !== "weapon") {
                continue;
            }
            let gunnerId = null;
            for (const roleId of roleIds) {
                const roleItem = shipActor.items.get(roleId);
                if (!roleItem) {
                    continue;
                }
                const bound = Object.values(roleItem.system.role.actions).find(
                    a => a.action === "weapon" && item.system.hardware.weapons?.[a.weapon]
                );
                if (bound) {
                    gunnerId = this._crewedActorIdFor(shipActor, roleId);
                    break;
                }
            }
            actions.push({
                mountId: item.id,
                label: item.name,
                gunnerId,
                disabled: !gunnerId
            });
        }
        return actions;
    }

    // Combat-relevant special actions from every crewed role, disabled (not omitted) if the role
    // currently has nobody assigned.
    _buildSpecialActions(shipActor) {
        const actions = [];
        for (const roleId of this._crewedRoleIds(shipActor)) {
            const roleItem = shipActor.items.get(roleId);
            if (!roleItem) {
                continue;
            }
            const crewId = this._crewedActorIdFor(shipActor, roleId);
            for (const [actionId, action] of Object.entries(roleItem.system.role.actions)) {
                if (action.action === "special" && COMBAT_PANEL_SPECIALS.has(action.special)) {
                    actions.push({
                        roleId,
                        actionId,
                        crewId,
                        label: action.title,
                        crewName: game.actors.get(crewId)?.name ?? "Unassigned",
                        disabled: !crewId
                    });
                }
            }
        }
        return actions;
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".ncp-special-action").on("click", async ev => {
            const { roleId, actionId, crewId } = ev.currentTarget.dataset;
            if (!crewId) {
                return;
            }
            const shipActor = game.combat?.combatant?.actor;
            if (!shipActor) {
                return;
            }
            await runCrewAction(shipActor, crewId, roleId, actionId);
        });

        html.find(".ncp-attack-action").on("click", ev => {
            const { mountId, gunnerId } = ev.currentTarget.dataset;
            if (!gunnerId) {
                return;
            }
            const shipActor = game.combat?.combatant?.actor;
            if (!shipActor) {
                return;
            }
            const mount = shipActor.items.get(mountId);
            const gunner = game.actors.get(gunnerId);
            new MgT2SpacecraftAttackDialog(shipActor, gunner, mount, {}).render(true);
        });
    }
}
