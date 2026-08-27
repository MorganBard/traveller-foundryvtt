import {MgT2WorldActorSheet} from "./world.mjs";

export class MgT2WorldBrassSheet extends MgT2WorldActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["mgt2", "sheet", "actor", "mgt2e-world-brass"],
            template: "systems/mgt2e-piggy/templates/actor/actor-world-brass-sheet.html",
            width: 900, height: 720
        });
    }

    get template() {
        return "systems/mgt2e-piggy/templates/actor/actor-world-brass-sheet.html";
    }
}
