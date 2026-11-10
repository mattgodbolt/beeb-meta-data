/**
 * Teletext Canvas's moments for tools/symbols/check-memory.js: as it scrolls the picture down and back, then while
 * the cursor keys scroll it.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const ScrollSecs = 3;
const ScrollBackSecs = 15;
const KeyFrames = 50;

const Viewer = ["viewer/code"];

export const scenarios = {
    async view({ session, address, shots, check }) {
        await session.runUntilAddress(address("viewer", "code", "main"));
        await runSeconds(session, ScrollSecs);
        check("the picture scrolling down", Viewer);
        await session.runUntilAddress(address("viewer", "code", "main.loop_keys"), ScrollBackSecs);
        check("the cursor keys' loop", Viewer);
        await pressKey(session, BBC.DOWN, KeyFrames);
        check("scrolled with the cursor keys", Viewer);
        await runScript(session, ["shot keys"], { shots });
        await pressKey(session, BBC.UP, KeyFrames);
        check("scrolled back", Viewer);
    },
};
