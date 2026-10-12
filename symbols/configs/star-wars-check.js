/** Star Wars' moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main", "game/shields_string"],
        loadSecs: 40,
        start: ["N", "SPACE", "K1"],
        inGame: ["game", "main", "space_stage_main_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
