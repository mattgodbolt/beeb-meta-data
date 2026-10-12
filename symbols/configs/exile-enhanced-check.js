/** Exile (Enhanced version)'s moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["F0", "Y"],
        inGame: ["game", "main", "main_game_loop"],
        moves: ["Q", "W", "P", "L", "O", "K", "SPACE"],
    }),
};

export const titles = ["exile"];
