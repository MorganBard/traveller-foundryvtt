import { MgT2eOptionSheet } from "../items/v2/Option.mjs";

/**
 * Alternate brass/mahogany-themed sheet for Option items - pure CSS reskin, not a template swap
 * like the ApplicationV1 brass sheets. The V2 templates already use generic structural classes
 * rather than baking hardcoded colors into bespoke markup, so all PARTS/actions/logic are
 * inherited unchanged - only the .mgt2e-v2-brass scope class is added, see css/mgt2.css.
 */
export class MgT2eOptionBrassSheet extends MgT2eOptionSheet {
    static DEFAULT_OPTIONS = {
        classes: ["mgt2e-v2-brass"]
    };
}
