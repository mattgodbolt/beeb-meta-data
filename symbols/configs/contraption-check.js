/** Contraption's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page4", "game/main", "game/page74"],
        playing: ["game/page4", "game/main", "game/page74"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "invert_A_and_elapsed"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
