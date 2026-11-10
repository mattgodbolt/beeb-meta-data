/** Stipple 256's moments for tools/symbols/check-memory.js: on a Master, as it plots the dots, and once it's done. */

import { runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const PlottingSecs = 2;
const DoneSecs = 60;

const Intro = ["intro/code"];

export const machines = { plot: { model: "Master" } };

export const scenarios = {
    async plot({ session, address, shots, check }) {
        await session.runUntilAddress(address("intro", "code", "loop"));
        check("the dot loop starting", Intro);
        await runSeconds(session, PlottingSecs);
        check("plotting", Intro);
        await session.runUntilAddress(address("intro", "code", "hang"), DoneSecs);
        check("the picture done", Intro);
        await runScript(session, ["shot done"], { shots });
    },
};
