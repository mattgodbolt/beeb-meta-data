/** Zalaga's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/loader"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "check_if_same_frame"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
