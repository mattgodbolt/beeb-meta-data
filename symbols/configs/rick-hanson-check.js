/** Rick Hanson's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: typedScenario({
        loaded: [],
        playing: ["game/page4", "game/main"],
        loadSecs: 40,
        keys: ["RETURN", "RETURN", "RETURN", "RETURN", "RETURN"],
        keysSecs: 40,
        commands: ["look", "north", "inventory", "south", "east", "west", "take all"],
        inGame: ["game", "main", "check_input_word_against_vocabulary_loop"],
    }),
};
