/** By Fair Means or Foul (Standard version)'s moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page7", "game/main", "game/page1", "game/page4", "game/paged", "game/pagef", "game/page4b"],
        playing: ["game/page7", "game/main", "game/page1", "game/page4", "game/paged", "game/pagef", "game/page4b"],
        loadSecs: 30,
        start: ["F1"],
        inGame: ["game", "main", "check_nine_keys"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
