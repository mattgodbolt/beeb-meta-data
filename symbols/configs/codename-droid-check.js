/** Codename Droid's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main", "game/page3"],
        loadSecs: 60,
        start: ["SPACE"],
        inGame: ["game", "main", "update_player"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
