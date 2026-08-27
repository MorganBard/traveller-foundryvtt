import { MgT2eVehicleSheet } from "./Vehicle.mjs";

/**
 * Alternate brass/mahogany-themed sheet for Vehicle actors - pure CSS reskin, see OptionBrass.mjs
 * for why no template swap is needed. All PARTS/actions/logic inherited unchanged; only the
 * .mgt2e-v2-brass scope class is added (ApplicationV2 concatenates `classes` across the whole
 * inheritance chain automatically, confirmed live, so the parent's classes don't need repeating).
 */
export class MgT2eVehicleBrassSheet extends MgT2eVehicleSheet {
    static DEFAULT_OPTIONS = {
        classes: ["mgt2e-v2-brass"]
    };
}
