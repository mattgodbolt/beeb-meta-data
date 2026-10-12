/** Jet Set Willy's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main", "game/page5a"],
        playing: ["game/main", "game/page5a"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "plot_or_unplot_player_sprite"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
