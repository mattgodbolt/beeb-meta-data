/** Sphere of Destiny's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main", "game/player_mask"],
        playing: ["game/main", "game/player_mask"],
        loadSecs: 30,
        start: ["K1"],
        inGame: ["game", "main", "plot_player_row_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
