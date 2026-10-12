/** Dare Devil Denis' moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/loader", "game/main", "game/title"],
        playing: ["game/main"],
        loadSecs: 40,
        start: ["SPACE", "A"],
        inGame: ["game", "main", "replot_player"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
