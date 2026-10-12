/** Arcadians's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/sprites", "game/main", "game/relocate"],
        playing: ["game/sprites", "game/main"],
        loadSecs: 30,
        start: ["K1"],
        inGame: ["game", "main", "to_move_player"],
        moves: ["Z", "X", "RETURN"],
    }),
};
