/** Exile's supervisor's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

const moves = ["Q", "W", "P", "L", "O", "K", "SPACE"];

export const scenarios = {
    standard: playScenario({
        loaded: ["menu/main"],
        playing: ["exile-game/main"],
        loadSecs: 30,
        start: ["F0", "N"],
        inGame: ["exile-game", "main", "update_player"],
        moves,
        moments: 3,
    }),
    enhanced: playScenario({
        loaded: ["menu/main"],
        playing: ["exile-enhanced-game/main"],
        loadSecs: 30,
        start: ["F0", "Y"],
        inGame: ["exile-enhanced-game", "main", "main_game_loop"],
        moves,
        moments: 3,
    }),
};

export const titles = ["exile", "exile-enhanced"];
