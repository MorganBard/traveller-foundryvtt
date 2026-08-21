import {MgT2ActorSheet} from "../actor-sheet.mjs";

// Alternate brass/mahogany-themed Spacecraft sheet - same pure template/visual swap as
// MgT2TravellerBrassSheet (traveller-brass.mjs). Every getData()/activateListeners()/_on*/_roll*
// method is inherited unchanged from MgT2ActorSheet (which already branches internally on
// actor.type === "spacecraft" for all of the spacecraft-specific logic - there is no separate
// spacecraft getData() to worry about), so this class only redirects where the sheet renders from.
export class MgT2SpacecraftBrassSheet extends MgT2ActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "actor", "mgt2e-spacecraft-brass"],
            template: "systems/mgt2e-piggy/templates/actor/actor-spacecraft-brass-sheet.html",
            width: 800,
            height: 720
        });
    }

    // See traveller-brass.mjs for why this override is required - MgT2ActorSheet's own
    // get template() derives the path from actor.type ("actor-${type}-sheet.html"), which would
    // silently override defaultOptions.template above.
    get template() {
        return "systems/mgt2e-piggy/templates/actor/actor-spacecraft-brass-sheet.html";
    }
}
