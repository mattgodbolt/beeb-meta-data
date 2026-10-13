/** Chuckie Egg's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/low", "game/main", "game/front"],
        playing: ["game/low", "game/main", "game/front"],
        loadSecs: 30,
        start: ["S", "K1"],
        inGame: ["game", "main", "plotplayer"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "SPACE"],
    }),
};
