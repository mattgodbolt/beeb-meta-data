/**
 * Beeb-Step's moments for tools/symbols/check-memory.js: on a Master, while it loads the tune into sideways RAM,
 * then as the effects play.
 */

import { runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const BootSecs = 10;
const LoadSecs = 90;
const PlayMoments = 6;
const PlaySecsPerMoment = 5;

const Demo = ["demo/code"];

export const machines = { play: { model: "Master" } };

export const scenarios = {
    async play({ session, address, shots, check }) {
        await runSeconds(session, BootSecs);
        check("loading the banks", Demo);
        await session.runUntilAddress(address("demo", "code", "effect_init"), LoadSecs);
        check("the effects starting", Demo);
        for (let moment = 1; moment <= PlayMoments; moment++) {
            await runSeconds(session, PlaySecsPerMoment);
            check(`the effects, moment ${moment}`, Demo);
        }
        await runScript(session, ["shot play"], { shots });
    },
};
