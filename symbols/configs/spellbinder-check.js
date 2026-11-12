/** Spellbinder's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page1"],
        playing: ["game/page1", "game/page3", "game/main", "game/text_strings"],
        loadSecs: 50,
        start: ["Z", "X", "COLON_STAR", "SLASH", "RETURN:0.1", "Y"],
        inGame: ["game", "main", "main_game_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
