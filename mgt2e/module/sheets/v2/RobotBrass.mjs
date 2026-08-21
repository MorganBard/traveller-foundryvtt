import { MgT2eRobotSheet } from "./Robot.mjs";

/**
 * Alternate brass/mahogany-themed sheet for Robot actors - pure CSS reskin, see OptionBrass.mjs
 * for why no template swap is needed. All PARTS/actions/logic inherited unchanged; only the
 * .mgt2e-v2-brass scope class is added (ApplicationV2 concatenates `classes` across the whole
 * inheritance chain automatically, confirmed live, so the parent's classes don't need repeating).
 */
export class MgT2eRobotBrassSheet extends MgT2eRobotSheet {
    static DEFAULT_OPTIONS = {
        classes: ["mgt2e-v2-brass"]
    };
}
