/** Knight Lore's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main", "game/bit_reversed_bytes", "game/page64"],
        playing: ["game/main", "game/bit_reversed_bytes", "game/page64"],
        loadSecs: 40,
        start: ["SPACE"],
        inGame: ["game", "main", "main_game_loop"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
