/**
 * VDFS's moments for tools/symbols/check-memory.js: the ROM in sideways RAM on a B, at the BASIC prompt and then at its
 * service entry, which `*HELP` reaches.
 */

import { typeUntil } from "../../tools/symbols/check-memory.js";

export const machines = { help: { model: "B", autoboot: false } };

export const scenarios = {
    async help({ address, check, session }) {
        check("BASIC's prompt", []);
        await typeUntil(session, "*HELP", address("rom", "rom", "service"));
        check("*HELP, in the service entry", ["rom/rom"]);
    },
};
