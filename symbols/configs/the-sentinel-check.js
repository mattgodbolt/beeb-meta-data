/** The Sentinel's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main", "game/page49"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "multiply_double_by_byte"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
