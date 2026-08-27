const { renderTemplate } = foundry.applications.handlebars;

// Finds the role Item on a ship whose bound actions include the given special, and whichever
// crew actor (if any) is currently assigned to it - role-agnostic by design (matches whatever
// the GM actually named the role, not a hardcoded "Pilot"/"Captain" string), same pattern as
// naval-gm-panel.mjs's _crewedRoleIds/_crewedActorIdFor.
function findAssignedRoleFor(shipActor, special) {
    const roleItem = shipActor.items.find(item =>
        item.type === "role" &&
        Object.values(item.system.role?.actions ?? {}).some(a => a.action === "special" && a.special === special)
    );
    if (!roleItem) {
        return null;
    }
    const crewed = shipActor.system.crewed?.crew ?? {};
    for (const crewId in crewed) {
        if (crewed[crewId][roleItem.id]?.assigned) {
            return { roleItem, crewActor: game.actors.get(crewId) };
        }
    }
    return { roleItem, crewActor: null };
}

export function findAssignedPilot(shipActor) {
    return findAssignedRoleFor(shipActor, "pilot");
}

export function findAssignedCaptain(shipActor) {
    // "improveInit" (Improve Initiative) is used as the Captain-role marker rather than
    // "tacticsInit" - Combat Tactics is no longer a bound action on the role at all (it's
    // requested directly by requestCombatTacticsIfNeeded), so it can't be searched for.
    return findAssignedRoleFor(shipActor, "improveInit");
}

// Pilot base (shipInitiativeRoll) and Combat Tactics (combatTacticsState) are stored as separate
// flags so a Pilot-base reroll in a later round (when shipInitiativePerRound is on) can never
// wipe out Tactics' one-time-per-encounter Effect - the two are only ever combined here, at the
// moment a final initiative number needs to be set. combatId must be passed and matched
// explicitly - shipInitiativeRoll isn't combat-scoped (it can carry over between encounters when
// shipInitiativePerRound is off), so without this check a stale, already-resolved Tactics Effect
// from a previous, unrelated encounter would get silently added back in.
export function computeShipInitiativeTotal(shipActor, combatId) {
    const pilotBase = parseInt(shipActor.getFlag("mgt2e-piggy", "shipInitiativeRoll")) || 0;
    const tactics = shipActor.getFlag("mgt2e-piggy", "combatTacticsState");
    const tacticsEffect = (tactics?.combatId === combatId && tactics?.status === "resolved") ? tactics.value : 0;
    return pilotBase + tacticsEffect;
}

// Combat Tactics (Naval) is rolled once "at the start of a battle" (Core Rulebook), not every
// round - this only ever sends the request once per Combat document per ship. Resolution
// (Tools.resolveCombatTacticsRequest) happens later, asynchronously, whenever the Captain's
// player actually clicks Roll or Decline; this function only sends the request (or records why
// none was sent) and returns immediately.
export async function requestCombatTacticsIfNeeded(combat, shipActor) {
    const state = shipActor.getFlag("mgt2e-piggy", "combatTacticsState");
    if (state && state.combatId === combat.id) {
        return; // Already pending/resolved/declined/no-captain for this encounter.
    }

    const captain = findAssignedCaptain(shipActor);
    if (!captain?.crewActor) {
        await shipActor.setFlag("mgt2e-piggy", "combatTacticsState", {
            combatId: combat.id, status: "no-captain", value: 0
        });
        return;
    }

    await shipActor.setFlag("mgt2e-piggy", "combatTacticsState", {
        combatId: combat.id, status: "pending", value: 0
    });

    const content = await renderTemplate(
        "systems/mgt2e-piggy/templates/chat/ship-combat-tactics-request.html",
        {
            shipId: shipActor.id,
            shipName: shipActor.name,
            captainId: captain.crewActor.id,
            captainName: captain.crewActor.name
        }
    );

    const owner = captain.crewActor.findActorOwner();
    const whisper = game.users
        .filter(u => u.active && (u.isGM || u.id === owner?.id))
        .map(u => u.id);

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: shipActor }),
        whisper,
        content
    });
}
