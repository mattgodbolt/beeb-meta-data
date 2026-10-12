/**
 * The B+'s MOS set's moments for tools/symbols/check-memory.js. jsbeeb has no B+ model, so these only show the set
 * matching nowhere else; tests/symbols/test-shipped-rom-sets.js checks it against bpos.rom.
 */

export const machines = {
    b: { model: "B-DFS1.2", autoboot: false },
    master: { model: "Master", autoboot: false },
};

const nowhere = async ({ check }) => check("BASIC's prompt", []);

export const scenarios = { b: nowhere, master: nowhere };
