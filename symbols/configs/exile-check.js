/** Exile (Standard version)'s moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["F0", "N"],
        inGame: ["game", "main", "update_player"],
        moves: ["Q", "W", "P", "L", "O", "K", "SPACE"],
    }),
};

export const titles = ["exile-enhanced"];
