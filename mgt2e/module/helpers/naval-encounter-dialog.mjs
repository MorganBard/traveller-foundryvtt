import { MGT2 } from "./config.mjs";
import { initRangeBandsForEncounter } from "./naval-course.mjs";

// GM-only, one-shot dialog for starting a naval encounter: pick which spacecraft actors (PC and
// NPC alike) are involved and a starting Range Band, then adds them to combat directly as
// Actor-only Combatants - no token, no scene, matching this system's deliberately map-less
// naval combat design. This is the only place in the codebase that creates Combatants
// programmatically; everywhere else in this system, Combatants come from Foundry's native
// token-drag-then-roll-initiative flow, which naval combat doesn't use at all.
export class MgT2StartNavalEncounterDialog extends Application {
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.id = "mgt2e-naval-encounter";
        options.classes = ["mgt2e-naval-encounter"];
        options.template = "systems/mgt2e-piggy/templates/naval-encounter-dialog.html";
        options.width = 360;
        options.height = "auto";
        options.title = "Start Naval Encounter";
        options.popOut = true;
        options.resizable = true;
        return options;
    }

    getData() {
        const ships = game.actors
            .filter(actor => actor.type === "spacecraft")
            .map(actor => ({ id: actor.id, name: actor.name, isPC: actor.hasPlayerOwner }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            ships,
            // Defaults to Very Long (index 5) - RAW's own suggestion for where most hostile
            // encounters first detect one another.
            rangeBands: MGT2.RANGE_BANDS.map((band, index) => ({ index, label: band.label, selected: index === 5 }))
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find(".start-encounter").on("click", async () => {
            const selectedIds = html.find(".encounter-ship-checkbox:checked")
                .map((i, el) => el.value).get();
            if (selectedIds.length < 2) {
                ui.notifications.error("Select at least two ships to start a naval encounter.");
                return;
            }
            const startingBand = parseInt(html.find(".starting-band").val()) || 0;

            let combat = game.combat;
            if (!combat) {
                // Deliberately no `scene` specified - naval combat has no scene/map involved at
                // all. Foundry's own default behavior here (falls back to the viewed scene, or
                // stays sceneless if none) needs confirming live; this is the single highest-risk
                // line in the tokenless-combat design, flagged for live verification.
                combat = await Combat.create({});
                await combat.activate();
            }

            const existingActorIds = new Set(combat.combatants.map(c => c.actorId));
            const toCreate = selectedIds
                .filter(id => !existingActorIds.has(id))
                .map(actorId => ({ actorId }));
            if (toCreate.length) {
                await combat.createEmbeddedDocuments("Combatant", toCreate);
            }

            await initRangeBandsForEncounter(combat, startingBand);
            ui.notifications.info(`Naval encounter started with ${selectedIds.length} ships.`);
            this.close();
        });
    }
}
