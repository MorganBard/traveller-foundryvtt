import {MgT2SoftwareItemSheet} from "./software.mjs";

// Alternate brass/mahogany-themed sheet for Software items - subclasses the dedicated
// MgT2SoftwareItemSheet (not the raw MgT2ItemSheet catch-all) so its extra getData()/
// activateListeners() logic (install-target selects, installedOn handler) is inherited unchanged.
export class MgT2SoftwareBrassSheet extends MgT2SoftwareItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "item", "software", "mgt2e-item-brass"],
            width: 760,
            height: 560
        });
    }

    get template() {
        return "systems/mgt2e-piggy/templates/item/item-software-brass-sheet.html";
    }
}
