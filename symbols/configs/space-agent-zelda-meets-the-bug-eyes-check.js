/** Space Agent Zelda Meets The Bug Eyes' moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/page9", "game/main"],
        loadSecs: 40,
        start: ["K1", "SPACE"],
        inGame: ["game", "main", "main_game_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
