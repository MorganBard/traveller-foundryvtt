import { setShipFacing, bearingOfShip } from "./naval-maneuver.mjs";
import { highlightSector, clearSectorHighlight } from "./canvas/range-rings.mjs";

const { renderTemplate } = foundry.applications.handlebars;

export class MgT2ChangeHeadingDialog extends Application {
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.template = "systems/mgt2e-piggy/templates/change-heading-dialog.html";
        options.width = "auto";
        options.height = "auto";
        options.title = "Change Heading";
        options.popOut = true;
        options.resizable = true;

        return options;
    }

    constructor(shipActor, actorCrew) {
        super();
        this.shipActor = shipActor;
        this.actorCrew = actorCrew;
    }

    async getData() {
        const combat = game.combat;
        const currentFacing = parseInt(this.shipActor.getFlag("mgt2e-piggy", "facing")) || 0;

        const sectors = [];
        for (let s = 0; s < 6; s++) {
            sectors.push({ sector: s, current: s === currentFacing, ships: [] });
        }

        if (combat) {
            for (const combatant of combat.combatants) {
                const other = combatant.actor;
                if (!other || other.type !== "spacecraft" || other.id === this.shipActor.id) {
                    continue;
                }
                const bearing = await bearingOfShip(combat, this.shipActor, other);
                sectors[bearing].ships.push(other.name);
            }
        }

        return { actor: this.shipActor, sectors };
    }

    activateListeners(html) {
        super.activateListeners(html);

        const shipToken = canvas.tokens.placeables.find(t => t.actor?.id === this.shipActor.id);

        html.find(".heading-sector-button")
            .on("mouseenter", ev => {
                const sector = parseInt(ev.currentTarget.dataset.sector);
                highlightSector(shipToken, sector);
            })
            .on("mouseleave", () => {
                clearSectorHighlight();
            })
            .on("click", async ev => {
                const sector = parseInt(ev.currentTarget.dataset.sector);
                const oldFacing = parseInt(this.shipActor.getFlag("mgt2e-piggy", "facing")) || 0;
                await setShipFacing(this.shipActor, sector);

                const content = await renderTemplate(
                    "systems/mgt2e-piggy/templates/chat/ship-heading-roll.html",
                    {
                        actor: this.shipActor,
                        rollerName: this.actorCrew.name,
                        oldFacing,
                        newFacing: sector
                    }
                );
                const speaker = {
                    actor: this.actorCrew._id,
                    alias: game.i18n.format("MGT2.Role.ChatAlias", {
                        "actorName": this.actorCrew.name, "shipName": this.shipActor.name
                    }),
                    scene: game.scenes.current.id
                };
                await ChatMessage.create({ user: game.user.id, speaker, content });

                this.close();
            });
    }

    close(options) {
        clearSectorHighlight();
        return super.close(options);
    }
}
