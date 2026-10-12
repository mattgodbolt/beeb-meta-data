/** Eagle's Wing's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/silence_sound", "game/page70", "game/page32"],
        playing: ["game/page4", "game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "plot_vertical_strip_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
