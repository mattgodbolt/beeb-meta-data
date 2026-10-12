/** Sabre Wulf's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["RETURN"],
        inGame: ["game", "main", "reduce_screen_address_by_y_rows"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
