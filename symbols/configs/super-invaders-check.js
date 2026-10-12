/** Super Invaders's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["SPACE", "K1"],
        inGame: ["game", "main", "check_for_player_movement"],
        moves: ["Z", "X", "RETURN"],
    }),
};
