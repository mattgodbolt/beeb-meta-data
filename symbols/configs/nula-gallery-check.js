/**
 * The VideoNuLA Gallery's moments for tools/symbols/check-memory.js: on a Master, for its sideways and shadow RAM, as
 * volume 1 shows its logo and then its pictures; volume 2, whose !Boot is the same; and volume 3, whose disc holds an
 * older build of the gallery that the set doesn't name.
 */

import { runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const LoadSecs = 60;
const SlideMoments = 4;
const SlideSecsPerMoment = 10;
// Volume 3's older !Boot runs from here too, as its catalogue says.
const Volume3Exec = 0x1f06;

const Gallery = ["gallery/code"];

async function slides(session, check, expected) {
    for (let moment = 1; moment <= SlideMoments; moment++) {
        await runSeconds(session, SlideSecsPerMoment);
        check(`the slide show, moment ${moment}`, expected);
    }
}

export const machines = {
    volume1: { model: "Master" },
    volume2: { model: "Master", disc: "bbcnula2.ssd" },
    volume3: { model: "Master", disc: "bbcnula3.ssd" },
};

export const scenarios = {
    async volume1({ session, address, shots, check }) {
        await session.runUntilAddress(address("gallery", "code", "main.show_logo"));
        check("the logo", Gallery);
        await session.runUntilAddress(address("gallery", "code", "main.load_complete"), LoadSecs);
        await session.runUntilAddress(address("gallery", "code", "slide_show"));
        check("the first picture", Gallery);
        await slides(session, check, Gallery);
        await runScript(session, ["shot show"], { shots });
    },
    async volume2({ session, address, check }) {
        await session.runUntilAddress(address("gallery", "code", "main.load_complete"), LoadSecs);
        await session.runUntilAddress(address("gallery", "code", "slide_show"));
        check("volume 2's first picture", Gallery);
        await slides(session, check, Gallery);
    },
    async volume3({ session, check }) {
        await session.runUntilAddress(Volume3Exec);
        check("volume 3's gallery starting", []);
        await slides(session, check, []);
    },
};
