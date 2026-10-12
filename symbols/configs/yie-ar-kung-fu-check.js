/** Yie Ar Kung-Fu's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page5", "game/main"],
        playing: ["game/page5", "game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "update_hit"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
