/** Starship Command's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["RETURN"],
        inGame: ["game", "main", "check_for_keypresses"],
        moves: ["Z", "X", "RETURN"],
    }),
};
