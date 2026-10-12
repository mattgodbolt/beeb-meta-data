/** Doctor Who and the Warlord (Part B)'s moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: typedScenario({
        loaded: [],
        playing: ["game/main"],
        loadSecs: 30,
        keys: ["K2", "RETURN", ...Array(18).fill("RETURN")],
        keysSecs: 0,
        commands: ["look", "north", "inventory", "south", "east", "west", "take all"],
        inGame: ["game", "main", "process_input"],
    }),
};
