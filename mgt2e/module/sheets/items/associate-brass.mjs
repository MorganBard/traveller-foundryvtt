import {MgT2AssociateItemSheet} from "./associate.mjs";

// Alternate brass/mahogany-themed sheet for Associate items - same pure template-swap pattern as
// the other Brass sheets, but subclasses the DEDICATED MgT2AssociateItemSheet (not the raw
// MgT2ItemSheet catch-all) so its extra getData()/activateListeners() logic (relationship selects,
// randomise-relationship handler) is inherited unchanged too, not just the base class's.
export class MgT2AssociateBrassSheet extends MgT2AssociateItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "item", "associate", "mgt2e-item-brass"],
            width: 560,
            height: 480
        });
    }

    get template() {
        return "systems/mgt2e-piggy/templates/item/item-associate-brass-sheet.html";
    }
}
