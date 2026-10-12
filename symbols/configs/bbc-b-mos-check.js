/**
 * The B's MOS sets' moments for tools/symbols/check-memory.js: MOS 1.20 on jsbeeb's B with each of its DFSes, at
 * BASIC's prompt and in OSWRCH echoing a key; and on a Master, where no B MOS set matches. jsbeeb has no model with
 * the US, German or 0.10 MOS; tests/symbols/test-shipped-rom-sets.js checks those against their ROMs.
 */

const Mos120 = ["1.20/low", "1.20/middle", "1.20/boot", "1.20/high", "1.20/top-page"];

async function promptAndOswrch({ session, address, check }) {
    check("BASIC's prompt", Mos120);
    session.keyDown("KeyA");
    try {
        await session.runUntilAddress(address("1.20", "high", "oswrchEntryPoint"));
    } finally {
        session.keyUp("KeyA");
    }
    check("OSWRCH, echoing a key", Mos120);
}

export const machines = {
    dfs12: { model: "B-DFS1.2", autoboot: false },
    dfs1770: { model: "B1770", autoboot: false },
    master: { model: "Master", autoboot: false },
};

export const scenarios = {
    dfs12: promptAndOswrch,
    dfs1770: promptAndOswrch,
    async master({ check }) {
        check("BASIC's prompt", []);
    },
};
