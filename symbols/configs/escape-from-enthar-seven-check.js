/** Escape from Enthar Seven's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: typedScenario({
        loaded: ["game/adcode"],
        playing: ["game/adcode", "game/main"],
        loadSecs: 30,
        keys: ["A", ...Array(15).fill("SHIFT"), "SPACE", "SPACE"],
        keysSecs: 10,
        commands: ["look", "north", "inventory", "south", "east", "west", "take all"],
        inGame: ["game", "main", "check_input_word_against_vocabulary_loop"],
    }),
};
