/** Project Thesius's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: typedScenario({
        loaded: [],
        playing: ["game/rooms", "game/list_all_exits", "game/main"],
        loadSecs: 30,
        keys: ["SPACE"],
        keysSecs: 20,
        commands: ["look", "north", "inventory", "south", "examine desk", "look"],
        inGame: ["game", "main", "move_to_next_byte_of_text"],
    }),
};
