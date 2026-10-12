/** The Hunt's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: typedScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        keys: [],
        keysSecs: 0,
        commands: ["north", "inventory", "south", "east", "take all"],
        inGame: ["game", "main", "add_character_to_buffer"],
    }),
};
