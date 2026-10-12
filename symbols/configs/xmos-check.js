/**
 * XMOS's moments for tools/symbols/check-memory.js: a Master with the ROM the source builds in sideways
 * RAM, at BASIC's prompt and in several of its commands, then the same with the original 1992 ROM, which
 * the source no longer builds and which nothing should match.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, runSeconds, typeUntil } from "../../tools/symbols/check-memory.js";

const Rom = ["rom/low", "rom/middle", "rom/high"];
const CommandSecs = 2;
const SidewaysRamBank = 7;
const RomselBankMask = 0x0f;
const ServiceEntryOperand = 0x8004;
const ServiceCallsMost = 64;
const CyclesPerSecond = 2000000;

/** Types a line, stopping where the ROM in sideways RAM is paged in at its service entry, which other ROMs may share. */
async function typeUntilServiceEntry(session, text) {
    const [low, high] = session.readMemory(ServiceEntryOperand, 2, { bank: SidewaysRamBank });
    const entry = low | (high << 8);
    const pagedIn = () =>
        session.registers().pc === entry && (session.pagingState().romsel & RomselBankMask) === SidewaysRamBank;
    const id = session.addBreakpoint("execute", entry);
    try {
        await session.type(text);
        for (let call = 0; call < ServiceCallsMost && !pagedIn(); call++) await session.runFor(CyclesPerSecond);
    } finally {
        session.removeBreakpoint(id);
    }
    if (!pagedIn()) throw new Error(`Typing ${text} never paged in the sideways RAM ROM's service entry`);
}

const Banks = 16;

/** Every sideways bank of the machine: only the ROM in sideways RAM matches, where `rom` (if given) is. */
function checkEveryBank(check, moment, rom) {
    for (let bank = 0; bank < Banks; bank++) check(moment, bank === SidewaysRamBank ? rom : [], { bank });
}

/** Whatever is paged in, as the debugger would see it at a prompt, which the MOS polls the ROMs from. */
function checkPaged({ session, check }, moment) {
    const pagedIn = (session.pagingState().romsel & RomselBankMask) === SidewaysRamBank;
    check(moment, pagedIn ? Rom : []);
}

async function command({ session, address, check }, text, region, name) {
    await typeUntil(session, text, address("rom", region, name));
    check(`running ${text}`, Rom);
    await runSeconds(session, CommandSecs);
}

export const machines = {
    commands: { model: "Master", autoboot: false },
    original: { model: "Master", autoboot: false, rom: "original.rom" },
};

export const scenarios = {
    async commands(context) {
        const { session, check } = context;
        checkEveryBank(check, "BASIC's prompt", Rom);
        await command(context, "*HELP XMOS", "low", "handle_help");
        checkPaged(context, "back at BASIC's prompt");
        await command(context, "*ALIAS L *LOAD %0", "middle", "cmd_alias");
        await command(context, "*ALIASES", "middle", "cmd_aliases");
        await command(context, "*KSTATUS", "low", "cmd_kstatus");
        await command(context, "*DIS 8000", "middle", "cmd_dis");
        await pressKey(session, BBC.ESCAPE);
        await runSeconds(session, CommandSecs);
        await command(context, "*XOFF", "low", "cmd_xoff");
        await command(context, "*XON", "low", "cmd_xon");
        checkPaged(context, "BASIC's prompt with extended input on");
    },

    async original({ session, check }) {
        checkEveryBank(check, "BASIC's prompt, the original XMOS in sideways RAM", []);
        await typeUntilServiceEntry(session, "*HELP XMOS");
        check("the original XMOS paged in for *HELP", []);
    },
};
