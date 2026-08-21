/**
 * A component (e.g. a weapon accessory) is linked to a parent item two ways: the parent stores
 * the component's id in system.links.components, and the component stores the parent's id back
 * in system.component.linkedTo (used by effect.mjs and actor-sheet.mjs to decide whether the
 * component counts as equipped/active). Both references only resolve within the collection the
 * two items share (an actor's items, the world Items directory, or a compendium), so when the
 * parent item is copied into a different collection - dragged onto a new actor, dragged to the
 * world Items sidebar, imported from a compendium - the linked components have to be cloned into
 * that same destination collection, with both references rewritten to point at the new copies,
 * or the link silently breaks.
 */

/**
 * Clone every component currently linked to sourceItem into newParentItem's collection, and
 * repoint newParentItem's system.links.components at the clones (each of which gets its own
 * system.component.linkedTo rewritten to newParentItem's id).
 * @param {Item} sourceItem - The original item that was copied, still holding its (pre-copy)
 *   system.links.components id references into its own collection.
 * @param {Item} newParentItem - The already-created copy of sourceItem, in the destination
 *   collection, whose links.components will be rewritten.
 * @param {Actor|null} targetActor - The actor to embed the cloned components on, or null/undefined
 *   to create them as world items instead.
 */
export async function attachClonedComponents(sourceItem, newParentItem, targetActor) {
    const ids = sourceItem?.system?.links?.components;
    if (!ids || !ids.length) {
        return;
    }
    const collection = sourceItem.collection;
    if (!collection) {
        return;
    }
    const componentDocs = ids.map(id => collection.get(id)).filter(doc => doc);
    if (!componentDocs.length) {
        return;
    }
    const componentData = componentDocs.map(doc => {
        const data = doc.toObject();
        foundry.utils.setProperty(data, "system.component.linkedTo", newParentItem.id);
        return data;
    });
    const created = targetActor
        ? await targetActor.createEmbeddedDocuments("Item", componentData)
        : await Item.createDocuments(componentData);
    await newParentItem.update({"system.links.components": created.map(doc => doc.id)});
}
