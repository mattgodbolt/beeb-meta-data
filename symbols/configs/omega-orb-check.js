/** Omega Orb's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/page11", "game/main", "game/page9", "game/sprites"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "page11", "update_player"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
