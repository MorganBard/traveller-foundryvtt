import { runCrewAction } from "./crew-actions.mjs";
import { getRangeBand } from "./naval-course.mjs";
import { MGT2 } from "./config.mjs";

// Combat-relevant special actions this console knows how to render a dedicated section for.
// Anything bound to a role that ISN'T in this set (e.g. pilot/tacticsInit/improveInit, which are
// start-of-encounter or captain-only actions handled elsewhere) is simply not shown - the console
// only surfaces what's relevant to running a round of combat from this one role's seat.
const CONSOLE_SPECIALS = new Set([
    "setCourse", "evade", "reassignCrew", "repair", "shipStatus", "scanTarget",
    "selfDestructVote", "sensorLock", "electronicWarfare", "pointDefence", "disperseSand"
]);

// Ordered rows for the Ship Status board, one per MGT2.SPACECRAFT_CRITICALS key. Order and
// wording here are the command-console presentation the Captain reads at a glance - deliberately
// separate from the abbreviated labels the repair dialog/chat cards use (M-Drive, J-Drive, etc.),
// which are tuned for a different, denser context.
const SHIP_STATUS_ROWS = [
    { key: "sensors", label: "Sensors" },
    { key: "powerPlant", label: "Power Plant" },
    { key: "fuel", label: "Fuel" },
    { key: "weapon", label: "Weapons" },
    { key: "armour", label: "Armor" },
    { key: "hull", label: "Hull" },
    { key: "cargo", label: "Cargo" },
    { key: "jDrive", label: "Jump Drive" },
    { key: "mDrive", label: "Maneuver Drive" },
    { key: "bridge", label: "Bridge" },
    { key: "crew", label: "Crew" }
];

// Single parametrized per-role ship control console, opened as (shipActor, roleId, crewActorId).
// Deliberately not six hardcoded classes - roles in this codebase are just free-form Items with
// a bound actions map, not a fixed enum, so this introspects whichever actions are actually bound
// to the given role and renders matching sections. Gated by ownership: shown to whoever owns the
// ship (players and GM alike), not GM-only like the older MgT2NavalGMPanel.
export class MgT2ShipConsoleApp extends Application {
    // Every currently-open console instance, so a crew reassignment (or any other actor change)
    // can live-refresh whichever consoles are watching that ship - a console doesn't necessarily
    // close just because its role got reassigned to someone else; it should just reflect that.
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
            id: "mgt2e-ship-console",
            classes: ["mgt2e-ship-console"],
            template: "systems/mgt2e-piggy/templates/ship-console.html",
            width: 380,
            height: "auto",
            resizable: true,
            popOut: true
        });
    }

    constructor(shipActor, roleId, crewActorId, options = {}) {
        super(options);
        this.shipActor = shipActor;
        this.roleId = roleId;
        this.crewActorId = crewActorId;
        MgT2ShipConsoleApp._openInstances.add(this);
    }

    close(options) {
        MgT2ShipConsoleApp._openInstances.delete(this);
        return super.close(options);
    }

    get title() {
        const roleItem = this.shipActor?.items.get(this.roleId);
        return `${this.shipActor?.name ?? "Ship"} - ${roleItem?.name ?? "Console"}`;
    }

    getData() {
        const shipActor = this.shipActor;
        if (!shipActor.isOwner && !game.user.isGM) {
            return { notOwner: true };
        }

        const roleItem = shipActor.items.get(this.roleId);
        const crewActor = game.actors.get(this.crewActorId);
        if (!roleItem) {
            return { notOwner: false, missingRole: true };
        }

        const actions = roleItem.system.role.actions ?? {};

        const genericRollActions = [];
        const weaponActions = [];
        const specials = {};

        for (const [actionId, action] of Object.entries(actions)) {
            if (action.action === "skill") {
                genericRollActions.push({ actionId, label: action.title });
            } else if (action.action === "weapon") {
                const weaponItem = shipActor.items.get(action.weapon);
                weaponActions.push({ actionId, label: action.title, weaponName: weaponItem?.name ?? "Unknown mount" });
            } else if (action.action === "special" && CONSOLE_SPECIALS.has(action.special)) {
                specials[action.special] = { actionId, label: action.title };
            }
        }

        let courseSection = null;
        if (specials.setCourse) {
            const otherShips = (game.combat?.combatants ?? [])
                .map(c => c.actor)
                .filter(actor => actor?.type === "spacecraft" && actor.id !== shipActor.id)
                .map(other => ({
                    id: other.id,
                    name: other.name,
                    band: this._bandLabel(getRangeBand(game.combat, shipActor.id, other.id)),
                    isTarget: shipActor.getFlag("mgt2e-piggy", "navTarget") === other.id
                }));
            courseSection = {
                actionId: specials.setCourse.actionId,
                navSpeed: parseInt(shipActor.getFlag("mgt2e-piggy", "navSpeed")) || 0,
                otherShips
            };
        }

        let damageSection = null;
        if (specials.repair) {
            damageSection = {
                actionId: specials.repair.actionId,
                ...this._buildDamageSummary(shipActor)
            };
        }

        let shipStatusSection = null;
        if (specials.shipStatus) {
            shipStatusSection = {
                rows: this._buildShipStatusRows(shipActor),
                hasWeaponMounts: shipActor.items.some(i => i.type === "hardware" && i.system.hardware?.system === "weapon"),
                hasCrew: Object.keys(shipActor.system.crewed?.crew ?? {}).length > 0
            };
        }

        let reassignSection = null;
        if (specials.reassignCrew) {
            const scope = actions[specials.reassignCrew.actionId].scope ?? "any";
            reassignSection = {
                actionId: specials.reassignCrew.actionId,
                scope,
                crew: Object.keys(shipActor.system.crewed?.crew ?? {})
                    .map(id => game.actors.get(id))
                    .filter(a => a)
                    .map(a => ({ id: a.id, name: a.name })),
                roles: shipActor.items
                    .filter(i => i.type === "role" && (scope === "any" || i.name === "Damage Control"))
                    .map(r => ({ id: r.id, name: r.name }))
            };
        }

        const selfDestructRoundsRemaining = shipActor.getFlag("mgt2e-piggy", "selfDestructRoundsRemaining");

        return {
            notOwner: false,
            shipActor,
            crewActor,
            roleName: roleItem.name,
            shipDescription: shipActor.system.description,
            genericRollActions,
            weaponActions,
            hasEvade: !!specials.evade,
            evadeActionId: specials.evade?.actionId,
            courseSection,
            damageSection,
            shipStatusSection,
            reassignSection,
            hasSelfDestructVote: !!specials.selfDestructVote,
            selfDestructVoteActionId: specials.selfDestructVote?.actionId,
            hasSensorLock: !!specials.sensorLock,
            sensorLockActionId: specials.sensorLock?.actionId,
            hasElectronicWarfare: !!specials.electronicWarfare,
            electronicWarfareActionId: specials.electronicWarfare?.actionId,
            hasPointDefence: !!specials.pointDefence,
            pointDefenceActionId: specials.pointDefence?.actionId,
            hasDisperseSand: !!specials.disperseSand,
            disperseSandActionId: specials.disperseSand?.actionId,
            hasScanTarget: !!specials.scanTarget && game.settings.get("mgt2e-piggy", "detailedSensorScans"),
            scanTargetActionId: specials.scanTarget?.actionId,
            selfDestructArmed: !!selfDestructRoundsRemaining,
            selfDestructRoundsRemaining
        };
    }

    _buildDamageSummary(shipActor) {
        return {
            hull: shipActor.system.hits,
            armour: shipActor.system.spacecraft?.armour,
            fuel: shipActor.system.spacecraft?.fuel,
            activeCriticals: Object.keys(MGT2.SPACECRAFT_CRITICALS ?? {})
                .filter(loc => shipActor.getFlag("mgt2e-piggy", `crit_${loc}`))
                .map(loc => ({
                    location: loc,
                    severity: shipActor.getFlag("mgt2e-piggy", `crit_${loc}`)
                }))
        };
    }

    _buildShipStatusRows(shipActor) {
        return SHIP_STATUS_ROWS.map(({ key, label }) => {
            const severity = parseInt(shipActor.getFlag("mgt2e-piggy", `crit_${key}`)) || 0;
            return {
                key,
                label,
                severity,
                statusLabel: severity === 0 ? "No Damage" : `Level ${severity}`
            };
        });
    }

    _bandLabel(bandIndex) {
        if (bandIndex === null || bandIndex === undefined) {
            return "Unknown";
        }
        return MGT2.RANGE_BANDS[bandIndex]?.label ?? "Unknown";
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".console-action").on("click", async ev => {
            const actionId = ev.currentTarget.dataset.actionId;
            if (!actionId) {
                return;
            }
            await runCrewAction(this.shipActor, this.crewActorId, this.roleId, actionId);
            this.render(false);
        });

        html.find(".console-open-weapons").on("click", async () => {
            const { MgT2WeaponStatusApp } = await import("./weapon-status.mjs");
            new MgT2WeaponStatusApp(this.shipActor).render(true);
        });

        html.find(".console-open-crew").on("click", async () => {
            const { MgT2CrewStatusApp } = await import("./crew-status.mjs");
            new MgT2CrewStatusApp(this.shipActor).render(true);
        });

        html.find(".console-abort").on("click", async () => {
            await this.shipActor.unsetFlag("mgt2e-piggy", "selfDestructCaptainVote");
            await this.shipActor.unsetFlag("mgt2e-piggy", "selfDestructEngineerVote");
            await this.shipActor.unsetFlag("mgt2e-piggy", "selfDestructRoundsRemaining");
            ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor: this.shipActor }),
                content: `<strong>${this.shipActor.name}</strong>: Self-destruct sequence aborted.`
            });
            this.render(false);
        });
    }
}
