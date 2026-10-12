/**
 * DFS 2.26's moments for tools/symbols/check-memory.js: disc commands on a B with the 1770 DFS, with and
 * without a second processor, and on two machines whose DFS isn't 2.26.
 */

import { runSeconds } from "../../tools/symbols/check-memory.js";

const CommandSecs = 3;
// In the loop that copies the write handler's middle over the read handler's, which the script leaves unnamed.
const CopyingWriteHandler = 0x8fb2;
// What holding Z through BREAK sets for drive 0, putting the DFS in its 8271 compatibility mode. Set by
// hand, since Z+BREAK stops a B's MOS 1.20 at a BRK in jsbeeb.
const Compatibility8271 = "?&10DE=&40";
const Osword7FRead = "DIM B% 20:?B%=0:B%!1=&3000:B%!3=&FFFF:B%?5=3:B%?6=&53:B%?7=0:B%?8=0:B%?9=&21";
const CallOsword7F = "A%=&7F:X%=B%:Y%=B% DIV256:CALL &FFF1";

const Rom = ["rom/low", "rom/middle", "rom/high"];
const Tube = ["tube/page4", "tube/page5"];

const finish = (session) => runSeconds(session, CommandSecs);

export const machines = {
    disc: { model: "B1770", autoboot: false },
    secondProcessor: { model: "B1770", tube: true, autoboot: false },
    dfs12: { model: "B-DFS1.2", tube: true, autoboot: false },
    master: { model: "Master", tube: true, autoboot: false },
};

export const scenarios = {
    async disc({ session, address, check }) {
        const nmi = address("rom", "nmi_read", "nmi_handler_ram");
        check("the prompt, before any disc access", []);
        await session.type("*CAT");
        await session.runUntilAddress(nmi);
        check("*CAT, in the read NMI handler", [...Rom, "rom/nmi_read"]);
        await finish(session);
        check("after *CAT", ["rom/nmi_read"]);
        await session.type("*SAVE TEST 3000 3100");
        await session.runUntilAddress(CopyingWriteHandler);
        await session.runUntilAddress(nmi);
        check("*SAVE, in the write NMI handler", Rom);
        await finish(session);
        check("after *SAVE", []);
        await session.type("*LOAD TEST");
        await session.runUntilAddress(nmi);
        check("*LOAD, in the read NMI handler", [...Rom, "rom/nmi_read"]);
        await finish(session);
        await session.type(Osword7FRead);
        await session.type(`${Compatibility8271}:${CallOsword7F}`);
        await session.runUntilAddress(address("rom", "middle", "nmi3_handler_rom_end"));
        await session.runUntilAddress(nmi);
        check("an 8271 read in compatibility mode, in its NMI handler", [...Rom, "rom/nmi_8271"]);
        await finish(session);
        check("after the 8271 read", ["rom/nmi_8271"]);
    },

    async secondProcessor({ session, address, check }) {
        const nmi = address("rom", "nmi_read", "nmi_handler_ram");
        check("the prompt, the Tube host in place", Tube);
        await session.type("*SAVE TEST 3000 3100");
        await session.runUntilAddress(CopyingWriteHandler);
        await session.runUntilAddress(nmi);
        check("*SAVE from the second processor, in the write NMI handler", [...Rom, ...Tube]);
        await finish(session);
        await session.type("*LOAD TEST");
        await session.runUntilAddress(nmi);
        check("*LOAD to the second processor, in the read NMI handler", [...Rom, ...Tube, "rom/nmi_read"]);
        await finish(session);
        check("after *LOAD", [...Tube, "rom/nmi_read"]);
    },

    async dfs12({ session, check }) {
        check("DFS 1.2's Tube host, whose page 5 is 2.26's", ["tube/page5"]);
        await session.type("*SAVE TEST 3000 3100");
        await session.type("*LOAD TEST");
        await finish(session);
        check("after DFS 1.2's *SAVE and *LOAD", ["tube/page5"]);
    },

    async master({ session, check }) {
        check("a Master's prompt", []);
        await session.type("*SAVE TEST 3000 3100");
        await runSeconds(session, 0.2);
        check("a Master's *SAVE, under way", []);
        await session.type("*LOAD TEST");
        await finish(session);
        check("after a Master's *LOAD", []);
    },
};
