/**
 * LISP 4.06's moments for tools/symbols/check-memory.js: a B with the ROM in sideways RAM, at BASIC's
 * prompt, at its own and evaluating.
 */

import { runSeconds, typeUntil } from "../../tools/symbols/check-memory.js";

const Rom = ["rom/low", "rom/middle", "rom/high"];
const CommandSecs = 2;

export const machines = { lisp: { autoboot: false } };

export const scenarios = {
    async lisp({ session, address, check }) {
        check("BASIC's prompt, LISP not paged in", []);
        await session.type("*LISP");
        await runSeconds(session, CommandSecs);
        check("LISP's prompt", Rom);
        await typeUntil(session, "(PLUS 1 2)", address("rom", "middle", "PLUS"));
        check("evaluating (PLUS 1 2)", Rom);
        await runSeconds(session, CommandSecs);
        await typeUntil(session, "(EVAL (QUOTE (TIMES 6 7)))", address("rom", "middle", "TIMES"));
        check("evaluating (TIMES 6 7) through EVAL", Rom);
    },
};
