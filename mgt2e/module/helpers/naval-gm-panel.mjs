import { runCrewAction } from "./crew-actions.mjs";
import { MgT2NavalAttackDialog, hasDetectedTarget } from "./naval-attack-dialog.mjs";
import { getRangeBand, getRangeBandProgress } from "./naval-course.mjs";
import { sensorDetailTier, sensorDetailGradeLabel } from "./sensor-detail.mjs";
import { MGT2 } from "./config.mjs";

// Combat-relevant "special" actions surfaced on the GM panel.
const COMBAT_PANEL_SPECIALS = new Set([
    "setCourse", "evade", "repair", "reassignCrew", "scanTarget", "detectTarget",
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
    // Pair picker (Fleet Status drill-down) - separate from _selectedShipId, which drives the
    // existing single-ship action list above it.
    static _pairAttackerId = null;
    static _pairTargetId = null;

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
        const selfDestructRoundsRemaining = shipActor.getFlag("mgt2e-piggy", "selfDestructRoundsRemaining");

        return {
            hasActiveShip: true,
            ships: ships.map(s => ({ id: s.id, name: s.name, selected: s.id === shipActor.id })),
            ship: shipActor,
            weaponActions: this._buildWeaponActions(shipActor),
            specialActions: this._buildSpecialActions(shipActor),
            genericRollActions: this._buildGenericRollActions(shipActor),
            selfDestructArmed: !!selfDestructRoundsRemaining,
            selfDestructRoundsRemaining,
            hasFleetStatus: ships.length >= 2,
            fleetStatusRows: this._fleetStatusRows(ships),
            pairPicker: this._pairPicker(ships)
        };
    }

    // Range Band, course, and detection state for every ship pair in the encounter, all at once -
    // Range Band state lives on the Combat document (naval-course.mjs), not any ship's own actor,
    // so this is the only place that can show the full tactical picture without opening every
    // ship's own console individually.
    _fleetStatusRows(ships) {
        const rawModel = game.settings.get("mgt2e-piggy", "navalRangeBandModel") === "raw";
        const rows = [];
        for (let i = 0; i < ships.length; i++) {
            for (let j = i + 1; j < ships.length; j++) {
                rows.push(this._pairDetail(ships[i], ships[j], rawModel));
            }
        }
        return rows;
    }

    // Secondary attacker/target drill-down, for inspecting one specific pair once the flat Fleet
    // Status list gets long with more ships in the encounter. Target choices exclude whichever
    // ship is currently selected as attacker - a ship can't usefully target itself.
    _pairPicker(ships) {
        if (ships.length < 2) {
            return null;
        }
        if (!MgT2NavalGMPanel._pairAttackerId || !ships.some(s => s.id === MgT2NavalGMPanel._pairAttackerId)) {
            MgT2NavalGMPanel._pairAttackerId = ships[0].id;
        }
        const targetChoices = ships.filter(s => s.id !== MgT2NavalGMPanel._pairAttackerId);
        if (!MgT2NavalGMPanel._pairTargetId || !targetChoices.some(s => s.id === MgT2NavalGMPanel._pairTargetId)) {
            MgT2NavalGMPanel._pairTargetId = targetChoices[0]?.id ?? null;
        }
        const attacker = game.actors.get(MgT2NavalGMPanel._pairAttackerId);
        const target = game.actors.get(MgT2NavalGMPanel._pairTargetId);
        const rawModel = game.settings.get("mgt2e-piggy", "navalRangeBandModel") === "raw";

        return {
            attackerOptions: ships.map(s => ({ id: s.id, name: s.name, selected: s.id === attacker.id })),
            targetOptions: targetChoices.map(s => ({ id: s.id, name: s.name, selected: s.id === target?.id })),
            detail: (attacker && target) ? this._pairDetail(attacker, target, rawModel) : null
        };
    }

    _pairDetail(shipA, shipB, rawModel) {
        const band = getRangeBand(game.combat, shipA.id, shipB.id);
        const aDetectsB = !!shipA.getFlag("mgt2e-piggy", "detected_" + shipB.id);
        const bDetectsA = !!shipB.getFlag("mgt2e-piggy", "detected_" + shipA.id);
        const sensorRawModel = game.settings.get("mgt2e-piggy", "sensorDetailModel") === "raw";
        return {
            shipAName: shipA.name,
            shipBName: shipB.name,
            bandLabel: (band === null || band === undefined) ? "Unknown" : (MGT2.RANGE_BANDS[band]?.label ?? "Unknown"),
            progress: rawModel ? getRangeBandProgress(game.combat, shipA.id, shipB.id) : null,
            aCourse: this._courseLabel(shipA, shipB),
            bCourse: this._courseLabel(shipB, shipA),
            aDetectsB,
            bDetectsA,
            // Only meaningful under the RAW sensor-detail model - a pure range+suite lookup, not a
            // roll, so it can be computed on demand for display rather than needing a scan action.
            aDetailGrade: (sensorRawModel && aDetectsB) ? sensorDetailGradeLabel(sensorDetailTier(shipA, band)) : null,
            bDetailGrade: (sensorRawModel && bDetectsA) ? sensorDetailGradeLabel(sensorDetailTier(shipB, band)) : null
        };
    }

    // observer's own course relative to other - "Closing" if other is observer's current
    // navTarget, "Opening" otherwise (including no target set at all), same logic
    // ship-console.mjs's courseSection already uses for the per-role console.
    _courseLabel(observer, other) {
        const navSpeed = parseInt(observer.getFlag("mgt2e-piggy", "navSpeed")) || 0;
        const closing = observer.getFlag("mgt2e-piggy", "navTarget") === other.id;
        return `${closing ? "Closing" : "Opening"} (speed ${navSpeed})`;
    }

    // Broker has no combat-relevant actions of its own - out of combat the GM just asks
    // whichever player has it to make the roll normally, so it's excluded here rather than
    // cluttering the combat panel's aggregated action lists with an irrelevant skill check.
    _crewedRoleIds(shipActor) {
        const roleIds = new Set();
        const crewed = shipActor.system.crewed?.crew ?? {};
        for (const actorId in crewed) {
            for (const roleId in crewed[actorId]) {
                if (!crewed[actorId][roleId]?.assigned) {
                    continue;
                }
                if (shipActor.items.get(roleId)?.name === "Broker") {
                    continue;
                }
                roleIds.add(roleId);
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
                    a => a.action === "weapon" && a.weapon === item.id
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
                if (action.action === "special" && action.special === "scanTarget"
                    && !game.settings.get("mgt2e-piggy", "detailedSensorScans")
                    && game.settings.get("mgt2e-piggy", "sensorDetailModel") !== "raw") {
                    continue;
                }
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

        html.find(".ncp-pair-attacker").on("change", ev => {
            MgT2NavalGMPanel._pairAttackerId = ev.currentTarget.value;
            if (MgT2NavalGMPanel._pairTargetId === MgT2NavalGMPanel._pairAttackerId) {
                MgT2NavalGMPanel._pairTargetId = null;
            }
            this.render(false);
        });

        html.find(".ncp-pair-target").on("change", ev => {
            MgT2NavalGMPanel._pairTargetId = ev.currentTarget.value;
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
            if (!hasDetectedTarget(shipActor)) {
                ui.notifications.warn("No detected targets - run a Sensors scan first.");
                return;
            }
            const mount = shipActor.items.get(mountId);
            const gunner = game.actors.get(gunnerId);
            new MgT2NavalAttackDialog(shipActor, gunner, mount, { theme: "tactical", rollMode: "gm" }).render(true);
        });

        html.find(".ncp-abort").on("click", async () => {
            const shipActor = game.actors.get(MgT2NavalGMPanel._selectedShipId);
            if (!shipActor) {
                return;
            }
            await shipActor.unsetFlag("mgt2e-piggy", "selfDestructCaptainVote");
            await shipActor.unsetFlag("mgt2e-piggy", "selfDestructEngineerVote");
            await shipActor.unsetFlag("mgt2e-piggy", "selfDestructRoundsRemaining");
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: shipActor }),
                content: `<strong>${shipActor.name}</strong>: Self-destruct sequence aborted.`
            });
            this.render(false);
        });
    }
}
