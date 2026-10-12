/** Monsters' moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: ["game/main"],
        loadSecs: 30,
        start: ["SPACE"],
        inGame: ["game", "main", "update_player_or_monster_screen_address"],
        moves: ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"],
    }),
};
