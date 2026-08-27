import {MgT2ActorSheet} from "../actor-sheet.mjs";

// Alternate brass/mahogany-themed Traveller (PC) sheet - purely a template/visual swap. Every
// getData()/activateListeners()/_on*/_roll* method is inherited unchanged from MgT2ActorSheet, so
// this class only needs to redirect where the sheet renders from. The new template
// (actor-traveller-brass-sheet.html) keeps the same data-tab names and every hook class/name
// attribute activateListeners() binds to, just restyled - see the "Design constraint" note in the
// implementation plan for why that contract matters.
export class MgT2TravellerBrassSheet extends MgT2ActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "actor", "mgt2e-traveller-brass"],
            template: "systems/mgt2e-piggy/templates/actor/actor-traveller-brass-sheet.html",
            width: 800
        });
    }

    // MgT2ActorSheet's own get template() derives the path from actor.type
    // ("actor-${type}-sheet.html"), which would silently override defaultOptions.template above -
    // this sheet is only ever registered for type "traveller", but still needs its own fixed
    // template path rather than the inherited type-derived one.
    get template() {
        return "systems/mgt2e-piggy/templates/actor/actor-traveller-brass-sheet.html";
    }
}
