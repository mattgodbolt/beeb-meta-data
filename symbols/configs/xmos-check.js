/**
 * XMOS's moments for tools/symbols/check-memory.js: a Master with the ROM the source builds in sideways
 * RAM, at BASIC's prompt and in several of its commands, then the same with the original 1992 ROM, which
 * only the 1992 set (xmos-1992's) names. Each title's set has to match nothing while the other's ROM is in.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, runSeconds, typeUntil } from "../../tools/symbols/check-memory.js";

const CommandSecs = 2;
const SidewaysRamBank = 7;
const RomselBankMask = 0x0f;
const Banks = 16;
const Original = "xmos-1992-rom";

/** A ROM set's regions, by its id among the sets the check has. */
export const romRegions = (id) => [`${id}/low`, `${id}/middle`, `${id}/high`];

/** Every sideways bank of the machine: only the ROM in sideways RAM matches, as `expected`. */
export function checkEveryBank(check, moment, expected) {
    for (let bank = 0; bank < Banks; bank++) check(moment, bank === SidewaysRamBank ? expected : [], { bank });
}

/** Whatever is paged in, as the debugger would see it at a prompt, which the MOS polls the ROMs from. */
function checkPaged({ session, check }, moment, expected) {
    const pagedIn = (session.pagingState().romsel & RomselBankMask) === SidewaysRamBank;
    check(moment, pagedIn ? expected : []);
}

/** Runs several of XMOS's commands, checking the set `id` (and only it) matches while each runs. */
export async function runCommands(context, id) {
    const { session, address, check } = context;
    const expected = romRegions(id);
    const command = async (text, region, name) => {
        await typeUntil(session, text, address(id, region, name));
        check(`running ${text}`, expected);
        await runSeconds(session, CommandSecs);
    };
    checkEveryBank(check, "BASIC's prompt", expected);
    await command("*HELP XMOS", "low", "handle_help");
    checkPaged(context, "back at BASIC's prompt", expected);
    await command("*ALIAS L *LOAD %0", "middle", "cmd_alias");
    await command("*ALIASES", "middle", "cmd_aliases");
    await command("*KSTATUS", "low", "cmd_kstatus");
    await command("*DIS 8000", "middle", "cmd_dis");
    await pressKey(session, BBC.ESCAPE);
    await runSeconds(session, CommandSecs);
    await command("*XOFF", "low", "cmd_xoff");
    await command("*XON", "low", "cmd_xon");
    checkPaged(context, "BASIC's prompt with extended input on", expected);
}

export const titles = ["xmos-1992"];

export const machines = {
    commands: { model: "Master", autoboot: false },
    original: { model: "Master", autoboot: false, rom: "original.rom" },
};

export const scenarios = {
    commands: (context) => runCommands(context, "rom"),
    original: (context) => runCommands(context, Original),
};
