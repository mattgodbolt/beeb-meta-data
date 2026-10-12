/** Skirmish's moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/page1", "game/main"],
        playing: ["game/page1", "game/main"],
        loadSecs: 30,
        start: ["F4"],
        inGame: ["game", "main", "consider_checking_for_player_movement"],
        moves: ["CAPSLOCK", "CTRL", "S"],
    }),
};
