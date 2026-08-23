import { MGT2 } from "./helpers/config.mjs";
import {getTraitValue} from "./helpers/dice-rolls.mjs";

async function migrateActorData(actor, fromVersion) {
    if (!actor.name) {
        return {};
    }
    console.log(`MIGRATE ACTOR ${actor.name} FROM ${fromVersion}`);

    if (actor.items) {
        for (let item of actor.items) {
            console.log(`Actor ${actor.name} has item ${item.name}`);
            if (item && item.update) {
                migrateItemData(item, fromVersion);
            }
        }
    }
    if (fromVersion < 7) {
        console.log("No longer supporting conversion from schema pre-7");
    }
    if (fromVersion < 8) {
        console.log("Converting to v8 (Spacecraft computers)");
        if (actor.type === "spacecraft") {
            if (actor.system.spacecraft.computer) {
                let c = actor.system.spacecraft.computer;

                let system = {
                    "tl": c.tl, "weight": 0, "cost": 0, "notes": "",
                    "active": true, "quantity": 1, "status": null,
                    "hardware": {
                        "system": "computer",
                        "tons": 0,
                        "power": 0,
                        "rating": c.processing,
                        "tonnage": {
                            "tons": 0, "percent": 0, "cost": 0, "minimum": 0
                        },
                        "powerPerTon": 0,
                        "mount": "turret",
                        "advantages": "",
                        "weapons": {},
                        "isComputerCore": c.core,
                        "isComputerBis": c.bis,
                        "isComputerFib": c.fib
                    }
                };

                let itemName = "Hardware";
                const itemData = {
                    "name": "Computer",
                    "img": "systems/mgt2e-piggy/icons/hardware/computer.svg",
                    "type": "hardware",
                    "system": system
                };
                Item.create(itemData, { parent: actor } );
            }
        }
    }

    if (fromVersion < 9) {
        if (["traveller", "npc"].includes(actor.type)) {
            console.log(`Migrating Actor entity ${actor.name} from ${fromVersion} to v9`);
            actor.effects.forEach(e => {
                console.log("Removing legacy active effect from " + actor.name);
                actor.effects.delete(e._id);
            });
            actor.update({"effects": actor.effects});
        }
    }

    return {};
}

function addWeaponTrait(traits, trait) {
    if (traits && traits.length > 0) {
        return traits + ", " + trait;
    }
    return trait;
}

async function migrateItemData(item, fromVersion) {
    console.log(`MIGRATE ITEM DATA ${fromVersion}`);
    if (fromVersion < 4) {
        if (item.system.term) {
            await item.update({"system.term.termLength": 4});
        }
    }
    if (fromVersion < 7) {
        console.log("Converting to v7 (Weapon and armour traits)");
        if (item.system.armour && item.system.armour.otherTypes) {
            item.system.armour.otherTypes = item.system.armour.otherTypes.toLowerCase();
            await item.update({"system.armour.otherTypes": item.system.armour.otherTypes });
        }
        if (item.system.weapon && item.system.weapon.traits) {
            let traits = item.system.weapon.traits.toLowerCase();
            let updated = "";

            if (traits.match("verybulky") || traits.match("very bulky")) {
                updated = addWeaponTrait(updated, "veryBulky");
            } else if (traits.match("bulky")) {
                updated = addWeaponTrait(updated, "bulky");
            }
            if (traits.match("zerog") || traits.match("zero-g")) {
                updated = addWeaponTrait(updated, "zeroG");
            }
            for (let t of [ "stun", "scope", "destructive", "laserSight", "smart", "radiation"]) {
              if (traits.match(t.toLowerCase())) {
                  updated = addWeaponTrait(updated, t);
              }
            }
            if (traits.match("lopen")) {
                let lopen = getTraitValue(traits, "lopen");
                if (lopen && !isNaN(lopen) && parseInt(lopen) > 0) {
                    updated = addWeaponTrait(updated, "loPen");
                }
            } else if (traits.match("lo-pen")) {
                let lopen = getTraitValue(traits, "lo-pen");
                if (lopen && !isNaN(lopen) && parseInt(lopen) > 0) {
                    updated = addWeaponTrait(updated, "loPen");
                }
            }
            for (let t of [ "ap", "blast", "auto" ]) {
                if (traits.match(t)) {
                    let value = getTraitValue(traits, t);
                    if (value && !isNaN(value) && parseInt(value) > 0) {
                        updated = addWeaponTrait(updated, `${t} ${value}`);
                    }
                }
            }
            await item.update({"system.weapon.traits": updated});
        }
    }
    if (fromVersion < 10) {
        // Need to update augment types, move it from flag to system
        item.effects.forEach(e => {
           if (e.flags.augmentType) {
               let augmentType = e.flags.augmentType;
               if (e.system.augmentType) {
                   // Already correct.
               } else {
                   if (typeof augmentType === "string") {
                       e.system.augmentType = augmentType;
                   } else {
                       e.system.augmentType = "skillDM";
                   }
                   e.update({"system.augmentType": augmentType});
               }
               e.update({"flags.-=augmentType": null});
           }
        });
    }
    if (fromVersion < 11) {
        // Pilot roles: the maneuverClose/maneuverOpen/changeHeading actions were never wired to
        // any handler in crew-actions.mjs - dead buttons that looked clickable but did nothing.
        // Drop them, and backfill setCourse/accelerate/decelerate (the real, working mechanic)
        // if this role doesn't already have them, matching crew-role-builder.mjs's current output.
        if (item.type === "role" && item.system?.role?.actions) {
            const actions = item.system.role.actions;
            const isPilotRole = Object.values(actions).some(a => a.action === "special" && a.special === "pilot");
            if (isPilotRole) {
                const deadSpecials = ["maneuverClose", "maneuverOpen", "changeHeading"];
                const updates = {};
                for (const [key, action] of Object.entries(actions)) {
                    if (action.action === "special" && deadSpecials.includes(action.special)) {
                        updates[`system.role.actions.-=${key}`] = null;
                    }
                }

                const hasSpecial = (special) => Object.values(actions).some(a => a.action === "special" && a.special === special);
                // Not every role's action keys are the small sequential counter
                // crew-role-builder.mjs assigns (e.g. "0", "1", "2") - a hand-edited role's keys
                // can be arbitrary strings like "setCourseAction". Since every a-z/0-9 character
                // is technically a valid base36 digit, treating those as a sequence to continue
                // computed an astronomically large "next key" that silently failed Foundry's
                // update validation. A real random ID sidesteps the problem entirely.
                const nextActionId = () => foundry.utils.randomID();

                if (!hasSpecial("setCourse")) {
                    updates[`system.role.actions.${nextActionId()}`] = {
                        "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.SetCourse"),
                        "action": "special", "special": "setCourse"
                    };
                }
                if (!hasSpecial("accelerate")) {
                    updates[`system.role.actions.${nextActionId()}`] = {
                        "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Accelerate"),
                        "action": "special", "special": "accelerate"
                    };
                }
                if (!hasSpecial("decelerate")) {
                    updates[`system.role.actions.${nextActionId()}`] = {
                        "title": game.i18n.localize("MGT2.Role.BuiltIn.Action.Decelerate"),
                        "action": "special", "special": "decelerate"
                    };
                }

                if (Object.keys(updates).length > 0) {
                    console.log(`Migrating Pilot role item ${item.name} to v11 (dead maneuver actions removed, setCourse/accelerate/decelerate backfilled)`);
                    await item.update(updates);
                }
            }
        }
    }
    if (fromVersion < 12) {
        // Combat Tactics (Naval) is now a one-time-per-encounter check the GM's Roll Initiative
        // click requests directly from the Captain's player (see ship-initiative.mjs), not a
        // self-service console button - drop the now-dead tacticsInit action from existing
        // Captain roles so it stops showing up as a stale button. Improve Initiative is
        // untouched - it was already present and is now genuinely implemented.
        if (item.type === "role" && item.system?.role?.actions) {
            const actions = item.system.role.actions;
            const updates = {};
            for (const [key, action] of Object.entries(actions)) {
                if (action.action === "special" && action.special === "tacticsInit") {
                    updates[`system.role.actions.-=${key}`] = null;
                }
            }
            if (Object.keys(updates).length > 0) {
                console.log(`Migrating role item ${item.name} to v12 (dead tacticsInit console action removed)`);
                await item.update(updates);
            }
        }
    }
    return {};
}

export async function migrateWorld(fromVersion) {
    console.log("**** MIGRATE SCHEMA TO v12 ****");

    for (let actor of game.actors.contents) {
        // migrateActorData is async - must be awaited, both so its own internal item.update()
        // calls finish before moving to the next actor, and because leaving this unawaited was
        // passing a raw Promise into actor.update() below (a Promise is never "empty" per
        // foundry.utils.isEmpty, so this ran and threw "must be constructed with a DataModel or
        // Object" on every migration, aborting the loop at the first actor).
        const updateData = await migrateActorData(actor, fromVersion);
        if (!foundry.utils.isEmpty(updateData)) {
            //console.log(`Migrating Actor entity ${actor.name} from ${fromVersion}`);
            await actor.update(updateData);
        }
    }


    for (let item of game.items.contents) {
        const updateData = await migrateItemData(item, fromVersion);
        if (!foundry.utils.isEmpty(updateData)) {
            //console.log(`Migrating Item entity ${item.name} from ${fromVersion}`);
            await item.update(updateData);
        }
    }

    for (let scene of game.scenes.contents) {
        const tokens = scene.tokens.map(token => {
            const t = token.toJSON();
            if (!t.actorLink) {
                console.log(`Migrating Actor token ${token.name}`);
                const actor = foundry.utils.duplicate(t.delta);
                actor.type = t.actor?.type;
                migrateActorData(actor, fromVersion);
            }
            return t;
        });
    }

    for (let pack of game.packs.contents) {
        if (pack.metadata.packageType !== "world") {
            continue;
        }
        const packType = pack.metadata.type;
        if (!["Item", "Actor"].includes(packType)) {
            console.log(`Ignoring pack ${pack.metadata.label}`);
            continue;
        }
        console.log(`Migrating pack ${pack.metadata.label}`);
        const wasLocked = pack.locked;
        await pack.configure( { locked: false });
        await pack.migrate();
        const documents = await pack.getDocuments();

        for (let document of documents) {
            switch (packType) {
                case "Item":
                    await migrateItemData(document, fromVersion);
                    break;
            }
        }
        await pack.configure({locked: wasLocked});
    }
}
