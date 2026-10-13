/**
 * Chuckie Egg 2's moments for tools/symbols/check-memory.js: MENU and its instructions, with CE2DATA in its
 * sideways bank, CE2's loader copying the game down, the game playing, and BREAK back to MENU. Nothing
 * overwrites the loader once CE2 has loaded, so it matches from then on, back in MENU too.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { holdUntil, runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const BootSecs = 10;
const PlaySecs = 20;
const InstructionPages = 3;

const Game = ["game/code", "game/data", "game/loader"];

/** Gives a get_key `key`, and runs to the next get_key. */
async function nextKey(session, address, key) {
    await holdUntil(session, key, address("menu", "menu", "get_key.done"));
    await session.runUntilAddress(address("menu", "menu", "get_key"), BootSecs);
}

/** From the boot, past the instructions' pages, to the menu waiting for a key. */
async function toMenu(session, address) {
    await session.runUntilAddress(address("menu", "menu", "get_key"), BootSecs);
    for (let page = 0; page < InstructionPages; page++) await nextKey(session, address, BBC.SPACE);
}

const dataBank = (session, address) => session.readMemory(address("menu", "menu", "data_bank"), 1)[0];

export const scenarios = {
    async menu({ session, address, check, shots }) {
        await session.runUntilAddress(address("menu", "menu", "get_key"), BootSecs);
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
        await session.runUntilAddress(address("game", "loader", "loader"), BootSecs);
        check("CE2's loader entered", ["game/loader"]);
        await session.runUntilAddress(address("game", "loader", "start"), BootSecs);
        check("start, the game copied down", ["game/loader", "game/code"]);
        await session.runUntilAddress(address("game", "code", "game_loop"), BootSecs);
        check("the game loop", Game);
        await runSeconds(session, PlaySecs);
        await runScript(session, ["shot playing"], { shots });
        check("playing", Game);
        session.reset(false);
        await session.runUntilAddress(address("menu", "menu", "get_key"), BootSecs);
        check("BREAK, back to the menu", ["menu/menu", "game/loader"]);
    },
};
