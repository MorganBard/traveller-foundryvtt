import {MgT2CreatureActorSheet} from "../actor-sheet.mjs";

// Alternate brass/mahogany-themed Creature sheet - purely a template/visual swap, same approach
// as MgT2TravellerBrassSheet (traveller-brass.mjs). Deliberately reuses the "mgt2e-traveller-brass"
// CSS scope class rather than introducing a new "mgt2e-creature-brass" one: the two sheets share
// the same tsb-* structural building blocks (tsb-sheet/tsb-left/tsb-right/tsb-panel/svc-plate/
// svc-rivet) and the same underlying field classes (side-panel, box-title, field-label, items-list)
// the base (non-brass) Creature sheet already uses, so the existing CSS covers this sheet with no
// duplication needed.
export class MgT2CreatureBrassSheet extends MgT2CreatureActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "actor", "mgt2e-traveller-brass"],
            template: "systems/mgt2e-piggy/templates/actor/actor-creature-brass-sheet.html",
            width: 800
        });
    }

    // MgT2ActorSheet's own get template() derives the path from actor.type
    // ("actor-${type}-sheet.html"), which would silently override defaultOptions.template above.
    get template() {
        return "systems/mgt2e-piggy/templates/actor/actor-creature-brass-sheet.html";
    }
}
