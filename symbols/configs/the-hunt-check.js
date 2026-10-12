/** The Hunt's moments for tools/symbols/check-memory.js. */

import { typedScenario } from "../../tools/symbols/title-scenario.js";

const commands = ["north", "inventory", "south", "east", "take all"];
const inGame = ["game", "main", "add_character_to_buffer"];

export const machines = { tape: { tape: true } };

export const scenarios = {
    game: typedScenario({
        loaded: ["game/main"],
        playing: ["game/main"],
        loadSecs: 30,
        commands,
        inGame,
    }),
    tape: typedScenario({
        loaded: ["game/main", "game/page4"],
        playing: ["game/main", "game/page4"],
        loadSecs: 450,
        commands,
        inGame,
    }),
};
