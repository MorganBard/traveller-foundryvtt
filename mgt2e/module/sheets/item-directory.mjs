import {attachClonedComponents} from "../helpers/component-links.mjs";

/**
 * Extends the core Items sidebar directory so that dropping an item with linked components
 * (e.g. a weapon with an attached Suppressor) brings copies of those components along as new
 * world items, rewriting the dropped item's links to point at them - see
 * helpers/component-links.mjs for why this is needed.
 */
export class MgT2ItemDirectory extends foundry.applications.sidebar.tabs.ItemDirectory {
    async _createDroppedEntry(document) {
        const created = await super._createDroppedEntry(document);
        if (created && document.system?.links?.components?.length) {
            await attachClonedComponents(document, created, null);
        }
        return created;
    }
}
