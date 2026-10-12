/** Nightshade's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "plot_boundary_section"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
