/** Twin Kingdom Valley's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: typedScenario({
        loaded: ["game/page7a", "game/main"],
        playing: ["game/page7a", "game/page4", "game/pageb", "game/main"],
        loadSecs: 50,
        keys: ["SPACE", "SPACE", "SPACE", "SPACE", "SPACE", "K6"],
        keysSecs: 15,
        commands: ["look", "north", "inventory", "south", "east", "west", "take all"],
        inGame: ["game", "main", "convert_input_word_to_uppercase_loop"],
    }),
};
