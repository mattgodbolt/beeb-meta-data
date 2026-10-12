/** Kix's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page62"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "continue_drawing_line"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN"],
    }),
};
