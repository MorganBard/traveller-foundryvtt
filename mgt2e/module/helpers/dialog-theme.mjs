/**
 * Small roll/action dialogs (attack, damage, skill checks, etc) have no per-document
 * "Configure Sheet" picker the way actor/item sheets do, so the brass/mahogany theme for them is
 * offered as a per-player client setting instead - each player can turn it on or off for
 * themselves without affecting anyone else. See the "brassDialogs" setting registered in mgt2.mjs.
 */
export function dialogBrassClasses() {
    return game.settings.get("mgt2e-piggy", "brassDialogs") ? ["mgt2e-dialog-brass"] : [];
}
