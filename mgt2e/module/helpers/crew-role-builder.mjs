/**
 * Creates a built-in crew Role item (Captain, Pilot, Gunner, etc) on an actor, from the "Add Crew
 * Role" dropdown in crew-member-dialog.mjs. Originally lived only on MgT2ActorSheet (built for
 * Spacecraft), which meant Vehicle/Robot actor sheets - built on the separate ApplicationV2
 * MgT2eActorV2 hierarchy - had no _createCrewRole method at all: selecting a role there threw
 * immediately after the dialog closed, so the role was never actually created (hence "no
 * available roles" persisting no matter what you picked). Extracted here so both frameworks share
 * one implementation instead of duplicating ~170 lines.
 * @param {Actor} actor - The ship/vehicle/etc actor the role item is created on.
 * @param {string} roleType - One of captain/gunner/pilot/engineer/sensors/navigator/broker/medic/
 *   steward/mechanic.
 */
export function createCrewRole(actor, roleType) {
    let system = {
        "description": "",
        "role": {
            "actions": {},
            "department": false,
            "colour": null,
            "dei": 0
        }
    }
    let itemName = "Role";
    let img = null;

    let t = Date.now();
    if (roleType === "captain") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Captain");
        img = "systems/mgt2e-piggy/icons/items/roles/captain.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": game.i18n.localize("MGT2.Role.Special.CombatTactics"),
            "action": "special", "special": "tacticsInit"
        }
        system.role.actions[(t++).toString(36)] = {
            "title": game.i18n.localize("MGT2.Role.Special.ImproveInitiative"),
            "action": "special", "special": "improveInit"
        }
    } else if (roleType === "gunner") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Gunner");
        img = "systems/mgt2e-piggy/icons/items/roles/gunner.svg";
        system.role.actions[(t++).toString(36)]= {
            "title": "Gunner",
            "action": "weapon",
            "dm": 0,
            "weapon": null
        };
    } else if (roleType === "pilot") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Pilot");
        img = "systems/mgt2e-piggy/icons/items/roles/pilot.svg";

        if (actor.type === "vehicle" && actor.system.vehicle?.skill) {
            // Ground/air/water vehicles use the Drive/Flyer/Seafarer skill family, not spacecraft
            // piloting - the naval-combat actions below (evade, maneuver, heading, accelerate)
            // don't apply, so this is a distinct, smaller action set grounded in the Vehicle
            // Handbook's example checks for Drive and Flyer, rather than a skill-string patch
            // over the spacecraft action list.
            const skill = actor.system.vehicle.skill;
            const isFlyer = skill.startsWith("flyer.");
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Pilot"),
                "action": "skill", "cha": "DEX", "skill": skill, "target": 8, "dm": 0
            }
            system.role.actions[(t++).toString(36)] = {
                "title": "Avoid Obstacle",
                "action": "skill", "cha": "DEX", "skill": skill, "target": 8, "dm": 0,
                "text": "React to a sudden hazard - a pedestrian, debris, another vehicle."
            }
            system.role.actions[(t++).toString(36)] = {
                "title": "Difficult Manoeuvre",
                "action": "skill", "cha": "DEX", "skill": skill, "target": 10, "dm": 0,
                "text": "Rough terrain, a tight space, or otherwise pushing the vehicle hard."
            }
            system.role.actions[(t++).toString(36)] = {
                "title": "Race",
                "action": "skill", "cha": "DEX", "skill": skill, "target": 8, "dm": 0,
                "text": "Opposed check against another driver/pilot. Longer races may use END instead of DEX."
            }
            if (isFlyer) {
                system.role.actions[(t++).toString(36)] = {
                    "title": "Land Safely",
                    "action": "skill", "cha": "DEX", "skill": skill, "target": 6, "dm": 0
                }
            }
        } else {
            let skill = "pilot.spacecraft";
            if (actor.type === "spacecraft" && actor.system.spacecraft) {
                if (actor.system.spacecraft.dtons < 100) {
                    skill = "pilot.smallCraft";
                } else if (actor.system.spacecraft.dtons > 5000) {
                    skill = "pilot.capitalShips";
                }
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Pilot"),
                "action": "skill", "cha": "DEX", "skill": skill, "target": 8, "dm": 0
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.PortLanding"),
                "action": "skill", "cha": "DEX", "skill": skill, "target": 6, "dm": 0
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.WildLanding"),
                "action": "skill", "cha": "DEX", "skill": skill, "target": 10, "dm": 0
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Evade"),
                "action": "special", "special": "evade"
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.MakePilot"),
                "action": "special", "special": "pilot"
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.ManeuverClose"),
                "action": "special", "special": "maneuverClose"
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.ManeuverOpen"),
                "action": "special", "special": "maneuverOpen"
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.ChangeHeading"),
                "action": "special", "special": "changeHeading"
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Accelerate"),
                "action": "special", "special": "accelerate"
            }
            system.role.actions[(t++).toString(36)] = {
                "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Decelerate"),
                "action": "special", "special": "decelerate"
            }
        }
    } else if (roleType === "engineer") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Engineer");
        img = "systems/mgt2e-piggy/icons/items/roles/engineer.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Activate Jump",
            "action": "skill", "cha": "EDU", "skill": "engineer.jDrive",
            "target": 4, "dm": 0,
            "text": "Active Jump Drive"
        }
        system.role.actions[(t++).toString(36)] = {
            "title": "Offline System",
            "action": "skill", "cha": "EDU", "skill": "engineer.power",
            "target": 8, "dm": 0,
            "text": "Take systems offline"
        }
        system.role.actions[(t++).toString(36)] = {
            "title": "Overload Drive",
            "action": "skill", "cha": "INT", "skill": "engineer.mDrive",
            "target": 10, "dm": 0,
            "text": "Overload drive"
        }
        system.role.actions[(t++).toString(36)] = {
            "title": "Repair",
            "action": "special", "special": "repair"
        }
    } else if (roleType === "sensors") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Sensors");
        img = "systems/mgt2e-piggy/icons/items/roles/sensors.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Sensors",
            "action": "skill", "cha": "INT", "skill": "electronics.sensors", "target": 8, "dm": 0
        }
        system.role.actions[(t++).toString(36)] = {
            "title": "Comms",
            "action": "skill", "cha": "INT", "skill": "electronics.comms", "target": 8, "dm": 0
        }
    } else if (roleType === "navigator") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Navigator");
        img = "systems/mgt2e-piggy/icons/items/roles/navigator.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Jump-1",
            "action": "skill", "cha": "EDU", "skill": "astrogation", "target": 4, "dm": -1
        }
        system.role.actions[(t++).toString(36)] = {
            "title": "Jump-2",
            "action": "skill", "cha": "EDU", "skill": "astrogation", "target": 4, "dm": -2
        }
    } else if (roleType === "broker") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Broker");
        img = "systems/mgt2e-piggy/icons/items/roles/broker.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Broker",
            "action": "skill", "cha": "INT", "skill": "broker", "target": 8, "dm": 0
        }
    } else if (roleType === "medic") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Medic");
        img = "systems/mgt2e-piggy/icons/items/roles/medic.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Medic",
            "action": "skill", "cha": "INT", "skill": "medic", "target": 8, "dm": 0
        }
    } else if (roleType === "steward") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Steward");
        img = "systems/mgt2e-piggy/icons/items/roles/steward.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Steward",
            "action": "skill", "cha": "INT", "skill": "steward", "target": 8, "dm": 0
        }
    } else if (roleType === "mechanic") {
        itemName = game.i18n.localize("MGT2.Role.BuiltIn.Name.Mechanic");
        img = "systems/mgt2e-piggy/icons/items/roles/maintenance.svg";
        system.role.actions[(t++).toString(36)] = {
            "title": "Mechanic",
            "action": "skill", "cha": "INT", "skill": "mechanic", "target": 8, "dm": 0
        }
    } else {
        return;
    }
    const itemData = {
        "name": itemName,
        "img": img,
        "type": "role",
        "system": system
    };
    return Item.create(itemData, { parent: actor });
}
