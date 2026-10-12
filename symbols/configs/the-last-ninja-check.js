/** The Last Ninja's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/page9", "game/page11", "game/main", "game/page4", "game/path_sprite_0"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "page11", "rnd"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
