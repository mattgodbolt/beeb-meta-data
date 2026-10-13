/**
 * Chuckie Egg 2's moments for tools/symbols/check-memory.js: MENU and its instructions, with CE2DATA in its
 * sideways bank; CE2's loader copying the game down, the game playing, and BREAK back to MENU; and the
 * streaming edition, CE2S, which none of these sets name.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { holdUntil, runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const StepSecs = 10;
const PlaySecs = 20;
const InstructionPages = 3;

const Game = ["game/code", "game/data", "game/loader"];

/** Gives a get_key `key`, and runs to the next get_key. */
async function nextKey(session, address, key) {
    await holdUntil(session, key, address("menu", "menu", "get_key.done"));
    await session.runUntilAddress(address("menu", "menu", "get_key"), StepSecs);
}

/** From the boot, past the instructions' pages, to the menu waiting for a key. */
async function toMenu(session, address) {
    await session.runUntilAddress(address("menu", "menu", "get_key"), StepSecs);
    for (let page = 0; page < InstructionPages; page++) await nextKey(session, address, BBC.SPACE);
}

const dataBank = (session, address) => session.readMemory(address("menu", "menu", "data_bank"), 1)[0];

export const scenarios = {
    async menu({ session, address, check, shots }) {
        await session.runUntilAddress(address("menu", "menu", "get_key"), StepSecs);
        check("the instructions", ["menu/menu"]);
        for (let page = 0; page < InstructionPages; page++) await nextKey(session, address, BBC.SPACE);
        await runScript(session, ["shot menu"], { shots });
        check("the menu", ["menu/menu"]);
        check("the menu, in CE2DATA's bank", ["menu/menu", "game/data"], { bank: dataBank(session, address) });
        await nextKey(session, address, BBC.I);
        for (let page = 0; page < InstructionPages; page++) await nextKey(session, address, BBC.SPACE);
        check("the menu again, after the instructions", ["menu/menu"]);
    },

    async play({ session, address, check, shots }) {
        await toMenu(session, address);
        await holdUntil(session, BBC.P, address("menu", "menu", "get_key.done"));
        await session.runUntilAddress(address("game", "loader", "loader"), StepSecs);
        check("CE2's loader entered", ["game/loader", "game/startup"]);
        await session.runUntilAddress(address("game", "loader", "start"), StepSecs);
        check("start, the game copied down", ["game/loader", "game/startup", "game/code"]);
        await session.runUntilAddress(address("game", "code", "game_loop"), StepSecs);
        check("the game loop, the first room over the start-up code", Game);
        await runSeconds(session, PlaySecs);
        await runScript(session, ["shot playing"], { shots });
        check("playing", Game);
        session.reset(false);
        await session.runUntilAddress(address("menu", "menu", "get_key"), StepSecs);
        check("BREAK, back to the menu", ["menu/menu", "game/loader"]);
    },

    async streaming({ session, address, check, shots }) {
        await toMenu(session, address);
        await nextKey(session, address, BBC.D);
        await holdUntil(session, BBC.P, address("menu", "menu", "get_key.done"));
        await runSeconds(session, PlaySecs);
        await runScript(session, ["shot streaming"], { shots });
        check("CE2S playing", []);
    },
};
