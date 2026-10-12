/** Castle Quest's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const machines = { game: { model: "Master" } };

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/page3", "game/main"],
        loadSecs: 60,
        start: ["SPACE"],
        inGame: ["game", "main", "main_game_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
