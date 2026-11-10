/** Teletext Slojd's moments for tools/symbols/check-memory.js: the editor waiting for keys, then drawing with them. */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, runScript } from "../../tools/symbols/check-memory.js";

const KeyFrames = 10;

const Editor = ["editor/code"];
const DrawKeys = [BBC.RIGHT, BBC.MINUS, BBC.RIGHT, BBC.AT, BBC.DOWN, BBC.COLON_STAR, BBC.H, BBC.I];

export const scenarios = {
    async draw({ session, address, shots, check }) {
        await session.runUntilAddress(address("editor", "code", "main.main_loop"));
        check("the editor's main loop", Editor);
        for (const key of DrawKeys) await pressKey(session, key, KeyFrames);
        check("drawing on the canvas", Editor);
        await runScript(session, ["shot draw"], { shots });
    },
};
