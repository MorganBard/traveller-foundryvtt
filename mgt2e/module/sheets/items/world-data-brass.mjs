import {MgT2WorldDataItemSheet} from "./world-data.mjs";

// Alternate brass/mahogany-themed sheet for World Data items - subclasses the dedicated
// MgT2WorldDataItemSheet (not the raw MgT2ItemSheet catch-all) so its extra getData()/
// activateListeners() logic (per-datatype select maps and init helpers) is inherited unchanged.
export class MgT2WorldDataBrassSheet extends MgT2WorldDataItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "item", "world-data", "mgt2e-item-brass"],
            width: 600,
            height: 520
        });
    }

    get template() {
        return "systems/mgt2e-piggy/templates/item/item-worlddata-brass-sheet.html";
    }
}
