/** Stipple 256's moments for tools/symbols/check-memory.js: on a Master, as it plots the dots, and once it's done. */

import { runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const PlottingSecs = 2;
// cnt_hi's start: the dot loop reaches `hang` each time cnt_lo wraps, and stays there on the last.
const DotLoopWraps = 8;

const Intro = ["intro/code"];

export const machines = { plot: { model: "Master" } };

export const scenarios = {
    async plot({ session, address, shots, check }) {
        await session.runUntilAddress(address("intro", "code", "loop"));
        check("the dot loop starting", Intro);
        await runSeconds(session, PlottingSecs);
        check("plotting", Intro);
        for (let wrap = 0; wrap < DotLoopWraps; wrap++) await session.runUntilAddress(address("intro", "code", "hang"));
        check("the picture done", Intro);
        await runScript(session, ["shot done"], { shots });
    },
};
