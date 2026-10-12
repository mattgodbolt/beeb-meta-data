/** Spy vs. Spy's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main", "game/update_music"],
        playing: ["game/main", "game/update_music"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "plot_player"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
