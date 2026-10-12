/** Cyborg Warriors' moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page4", "game/high_score_names", "game/main"],
        playing: ["game/page4", "game/high_score_names", "game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "update_player_one"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
