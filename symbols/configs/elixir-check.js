/** Elixir's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page4", "game/low", "game/intro", "game/sprites"],
        playing: ["game/page4", "game/low", "game/main", "game/sprites"],
        loadSecs: 150,
        start: ["SPACE"],
        inGame: ["game", "main", "update_player"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
