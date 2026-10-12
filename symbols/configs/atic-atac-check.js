/** Atic Atac's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/font_data", "game/main"],
        playing: ["game/font_data", "game/main"],
        loadSecs: 40,
        start: ["SPACE"],
        inGame: ["game", "main", "update_player"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
