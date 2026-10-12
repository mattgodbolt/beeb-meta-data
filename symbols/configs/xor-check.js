/** XOR's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/page11", "game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "check_for_alternative_keys"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
