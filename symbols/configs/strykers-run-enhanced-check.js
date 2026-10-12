/** Stryker's Run (Enhanced version)'s moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

const Moves = ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"];

export const titles = ["strykers-run-standard"];

export const machines = { game: { model: "Master" } };

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main"],
        loadSecs: 40,
        start: ["K2", "K1"],
        inGame: ["game", "main", "update_player"],
        moves: Moves,
    }),
    standard: playScenario({
        loaded: [],
        playing: ["strykers-run-standard-game/main"],
        loadSecs: 40,
        start: ["K1"],
        inGame: ["strykers-run-standard-game", "main", "update_player"],
        moves: Moves,
    }),
};
