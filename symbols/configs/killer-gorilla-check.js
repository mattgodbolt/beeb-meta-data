/** Killer Gorilla's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 40,
        start: ["SPACE"],
        inGame: ["game", "main", "game_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
