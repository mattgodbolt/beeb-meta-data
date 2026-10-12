import { describe, expect, it } from "vitest";

import { BBC } from "jsbeeb/src/keymap.js";
import { keyStep, pressStep } from "../../tools/symbols/title-scenario.js";

describe("keyStep", () => {
    it("presses a key for the frames given, holds it for seconds, or holds it until an address", () => {
        expect(keyStep("SPACE", 50)).toEqual({ key: BBC.SPACE, frames: 50 });
        expect(keyStep("RETURN:1.5", 50)).toEqual({ key: BBC.RETURN, frames: 75 });
        expect(keyStep("SPACE:&1F00")).toEqual({ key: BBC.SPACE, until: 0x1f00 });
    });

    it("refuses a key the keymap hasn't, or a hold that's neither", () => {
        expect(() => keyStep("SPACEBAR")).toThrow("no key SPACEBAR");
        expect(() => keyStep("SPACE:soon")).toThrow("SPACE:soon");
    });
});

describe("pressStep", () => {
    it("holds the key down until the PC reaches the step's address", async () => {
        const calls = [];
        const session = {
            keyDownRaw: (key) => calls.push(["down", key]),
            keyUpRaw: (key) => calls.push(["up", key]),
            runUntilAddress: async (address) => calls.push(["until", address]),
        };
        await pressStep(session, keyStep("SPACE:&1F00"));
        expect(calls).toEqual([
            ["down", BBC.SPACE],
            ["until", 0x1f00],
            ["up", BBC.SPACE],
        ]);
    });
});
