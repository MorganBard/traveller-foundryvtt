import { runCrewAction } from "./crew-actions.mjs";
import { MgT2SpacecraftAttackDialog } from "./spacecraft-attack-dialog.mjs";

// Combat-relevant "special" actions surfaced on the GM panel.
const COMBAT_PANEL_SPECIALS = new Set([
    "setCourse", "evade", "repair", "reassignCrew",
    "selfDestructVote", "sensorLock", "electronicWarfare", "pointDefence", "disperseSand"
]);

// GM-facing, single (not per-crew-role) panel. Successor to the old MgT2NavalCombatPanel: rather
// than following whichever ship has initiative (there's no map to select a token from anymore),
// the GM picks which ship to view from a dropdown of every ship in the current encounter, and
// sees every crewed role's actions for that ship at once - unstyled, deliberately plain, unlike
// the themed per-player consoles (MgT2ShipConsoleApp).
export class MgT2NavalGMPanel extends Application {
    static _instance = null;
    static _selectedShipId = null;

    static show() {
        if (!this._instance) {
            this._instance = new MgT2NavalGMPanel();
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
            id: "mgt2e-naval-gm-panel",
            template: "systems/mgt2e-piggy/templates/naval-gm-panel.html",
            title: "Naval Combat Control",
            width: 380,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    close(options) {
        MgT2NavalGMPanel._instance = null;
        return super.close(options);
    }

    _ships() {
        return (game.combat?.combatants ?? [])
            .map(c => c.actor)
            .filter(a => a?.type === "spacecraft");
    }

    getData() {
        const ships = this._ships();
        if (!ships.length) {
            return { hasActiveShip: false, combatActive: !!game.combat };
        }

        if (!MgT2NavalGMPanel._selectedShipId || !ships.some(s => s.id === MgT2NavalGMPanel._selectedShipId)) {
            MgT2NavalGMPanel._selectedShipId = ships[0].id;
        }
        const shipActor = game.actors.get(MgT2NavalGMPanel._selectedShipId);

        return {
            hasActiveShip: true,
            ships: ships.map(s => ({ id: s.id, name: s.name, selected: s.id === shipActor.id })),
            ship: shipActor,
            weaponActions: this._buildWeaponActions(shipActor),
            specialActions: this._buildSpecialActions(shipActor),
            genericRollActions: this._buildGenericRollActions(shipActor)
        };
    }

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

    _crewedActorIdFor(shipActor, roleId) {
        const crewed = shipActor.system.crewed?.crew ?? {};
        for (const actorId in crewed) {
            if (crewed[actorId][roleId]?.assigned) {
                return actorId;
            }
        }
        return null;
    }

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
            actions.push({ mountId: item.id, label: item.name, gunnerId, disabled: !gunnerId });
        }
        return actions;
    }

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
                        roleId, actionId, crewId,
                        label: action.title,
                        crewName: game.actors.get(crewId)?.name ?? "Unassigned",
                        disabled: !crewId
                    });
                }
            }
        }
        return actions;
    }

    _buildGenericRollActions(shipActor) {
        const actions = [];
        for (const roleId of this._crewedRoleIds(shipActor)) {
            const roleItem = shipActor.items.get(roleId);
            if (!roleItem) {
                continue;
            }
            const crewId = this._crewedActorIdFor(shipActor, roleId);
            for (const [actionId, action] of Object.entries(roleItem.system.role.actions)) {
                if (action.action === "skill") {
                    actions.push({
                        roleId, actionId, crewId,
                        label: `${action.title} (${roleItem.name})`,
                        disabled: !crewId
                    });
                }
            }
        }
        return actions;
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".ncp-ship-select").on("change", ev => {
            MgT2NavalGMPanel._selectedShipId = ev.currentTarget.value;
            this.render(false);
        });

        html.find(".ncp-special-action, .ncp-roll-action").on("click", async ev => {
            const { roleId, actionId, crewId } = ev.currentTarget.dataset;
            if (!crewId) {
                return;
            }
            const shipActor = game.actors.get(MgT2NavalGMPanel._selectedShipId);
            if (!shipActor) {
                return;
            }
            await runCrewAction(shipActor, crewId, roleId, actionId);
            this.render(false);
        });

        html.find(".ncp-attack-action").on("click", ev => {
            const { mountId, gunnerId } = ev.currentTarget.dataset;
            if (!gunnerId) {
                return;
            }
            const shipActor = game.actors.get(MgT2NavalGMPanel._selectedShipId);
            if (!shipActor) {
                return;
            }
            const mount = shipActor.items.get(mountId);
            const gunner = game.actors.get(gunnerId);
            new MgT2SpacecraftAttackDialog(shipActor, gunner, mount, {}).render(true);
        });
    }
}
