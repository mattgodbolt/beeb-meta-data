/** Myorem's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

const Game = ["game/rooms", "game/main", "game/strings_three", "game/strings_four"];

export const scenarios = {
    game: typedScenario({
        loaded: Game,
        playing: Game,
        loadSecs: 30,
        commands: ["look", "north", "inventory", "say hello", "east", "look"],
        inGame: ["game", "main", "move_to_next_byte_of_text"],
    }),
};
