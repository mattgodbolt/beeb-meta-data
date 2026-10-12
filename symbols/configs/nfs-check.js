/**
 * NFS's and ANFS's moments for tools/symbols/check-memory.js: each version in sideways RAM, at BASIC's
 * prompt and in its service handler during *HELP, on a B or a Master as the version needs; and DNFS 1.20's
 * copy of NFS 3.60, on a B with DFS 1.2.
 */

import { readFileSync } from "node:fs";

import { typeUntil } from "../../tools/symbols/check-memory.js";

const Config = JSON.parse(readFileSync(new URL("nfs.json", import.meta.url), "utf8"));
const MasterVersions = new Set(["anfs-4.21", "anfs-4.24", "anfs-4.25", "anfs-4.26"]);
// On jsbeeb's Master a plain *HELP never reaches ANFS's service handler, and *HELP NET does.
const MasterHelp = "*HELP NET";
// Regions another version's set names, since the two ROMs hold the same bytes there.
const Borrowed = new Map([
    ["nfs-3.62", ["nfs-3.60/high", "nfs-3.60/tail"]],
    ["anfs-4.26", ["anfs-4.25/high"]],
]);
const SidewaysRamBank = 7;
const BankMask = 0x0f;
const MostStops = 10000;
// Enough to run past the instruction a stop is at.
const StepCycles = 10;

const inSidewaysRam = (session) => (session.pagingState().romsel & BankMask) === SidewaysRamBank;
const regionsOf = (sets, id) => sets[id].regions.map(({ name }) => `${id}/${name}`);

/**
 * Types a *HELP, stopping where the version's service handler first runs: the ROMs above it have code at
 * that address too, so the PC has to be there with sideways RAM paged in.
 */
async function helpUntil(session, help, address) {
    const id = session.addBreakpoint("execute", address);
    try {
        await session.type(help);
    } finally {
        session.removeBreakpoint(id);
    }
    for (let stop = 0; stop < MostStops; stop++) {
        if (session.registers().pc === address && inSidewaysRam(session)) return;
        await session.runFor(StepCycles);
        await session.runUntilAddress(address);
    }
    throw new Error(`${help} never ran sideways RAM's code at ${address.toString(16)}`);
}

export const machines = {
    dnfs: { model: "B-DFS1.2", autoboot: false },
    ...Object.fromEntries(
        Config.sets.map(({ id }) => [
            id,
            { model: MasterVersions.has(id) ? "Master" : "B1770", sideways: id, autoboot: false },
        ]),
    ),
};

export const scenarios = {
    async dnfs({ address, check, session }) {
        check("BASIC's prompt", []);
        await typeUntil(session, "*HELP", address("nfs-3.60", "low", "service_handler"));
        check("*HELP, in DNFS 1.20's service handler", ["nfs-3.60/low", "nfs-3.60/high"]);
    },
    ...Object.fromEntries(
        Config.sets.map(({ id, title }) => [
            id,
            async ({ address, check, session, sets }) => {
                const help = MasterVersions.has(id) ? MasterHelp : "*HELP";
                check("BASIC's prompt", []);
                await helpUntil(session, help, address(id, "low", "service_handler"));
                check(`${help}, in ${title}'s service handler`, [...regionsOf(sets, id), ...(Borrowed.get(id) ?? [])]);
            },
        ]),
    ),
};
