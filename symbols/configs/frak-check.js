/** Frak!'s moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ["game/title_screen", "game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "wait_for_frame_counter"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
