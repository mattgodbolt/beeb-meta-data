/** Kissin' Kousins' moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page4", "game/main", "game/page7b"],
        playing: ["game/page4", "game/main", "game/page7b"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "plot_or_unplot_sprite_column_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
