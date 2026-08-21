import {MgT2ItemSheet} from "../item-sheet.mjs";

// Alternate brass/mahogany-themed sheet for Weapon and Armour items - same pure template-swap
// pattern as MgT2TravellerBrassSheet/MgT2SpacecraftBrassSheet (actors/traveller-brass.mjs,
// actors/spacecraft-brass.mjs). getData()/activateListeners() are inherited unchanged from
// MgT2ItemSheet, so this class only redirects where the sheet renders from. One class serves both
// item types, mirroring MgT2ItemSheet's own dynamic per-type template resolution - it's only ever
// registered for ["weapon", "armour"], so the dynamic path never needs to resolve any other type.
export class MgT2ItemBrassSheet extends MgT2ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "item", "mgt2e-item-brass"],
            width: 720,
            height: 640
        });
    }

    // See traveller-brass.mjs for why this override is required - MgT2ItemSheet's own
    // get template() derives the path from item.type ("item-${type}-sheet.html"), which would
    // silently override any defaultOptions.template.
    get template() {
        return `systems/mgt2e-piggy/templates/item/item-${this.item.type}-brass-sheet.html`;
    }
}
