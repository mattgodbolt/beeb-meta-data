import { describe, expect, it } from "vitest";

import { BBC } from "jsbeeb/src/keymap.js";
import { keyStep, playScenario, pressStep, pressUntil, typedScenario } from "../../tools/symbols/title-scenario.js";

describe("keyStep", () => {
    it("presses a key for the frames given, holds it for seconds, or holds it until an address", () => {
        expect(keyStep("SPACE", 50)).toEqual({ key: BBC.SPACE, frames: 50 });
        expect(keyStep("RETURN:1.5", 50)).toEqual({ key: BBC.RETURN, frames: 75 });
        expect(keyStep("SPACE:&1F00")).toEqual({ key: BBC.SPACE, until: 0x1f00 });
    });

    it("refuses a key the keymap hasn't, or a hold that's neither seconds nor an &address", () => {
        expect(() => keyStep("SPACEBAR")).toThrow("no key SPACEBAR");
        for (const text of ["SPACE:soon", "SPACE:0", "SPACE:0x10", "SPACE:2:&1F00"])
            expect(() => keyStep(text)).toThrow(`${text} isn't KEY, KEY:SECS or KEY:&ADDRESS`);
        for (const text of ["SPACE:&zz", "SPACE:&", "SPACE:&12345"])
            expect(() => keyStep(text)).toThrow("An address is hex");
    });
});

// A machine that records the keys pressed, each with the frames it was held, and reaches every address.
function recordingSession({ reaches = true } = {}) {
    const keys = [];
    let down = null;
    return {
        keys,
        keyDownRaw: (key) => {
            down = { key, frames: 0 };
            keys.push(down);
        },
        keyUpRaw: () => (down = null),
        runFrames: async (frames) => {
            if (down) down.frames += frames;
        },
        runFor: async () => {},
        runUntilAddress: async () => {
            if (!reaches) throw new Error("did not hit appropriate breakpoint");
        },
        addBreakpoint: () => 1,
        removeBreakpoint: () => {},
        type: async () => {},
        registers: () => ({ pc: InGame }),
    };
}
const InGame = 0x1234;
const context = (session) => ({ session, address: () => InGame, check: () => {} });

describe("pressStep", () => {
    it("holds the key down until the PC reaches the step's address, and lets go if it never does", async () => {
        const calls = [];
        const session = {
            keyDownRaw: (key) => calls.push(["down", key]),
            keyUpRaw: (key) => calls.push(["up", key]),
            runUntilAddress: async (address) => {
                calls.push(["until", address]);
                throw new Error("did not hit appropriate breakpoint");
            },
        };
        await expect(pressStep(session, keyStep("SPACE:&1F00"))).rejects.toThrow("breakpoint");
        expect(calls).toEqual([
            ["down", BBC.SPACE],
            ["until", 0x1f00],
            ["up", BBC.SPACE],
        ]);
    });
});

describe("pressUntil", () => {
    it("says the PC never got there when a step's hold never reaches its address either", async () => {
        const session = recordingSession({ reaches: false });
        await expect(pressUntil(session, [keyStep("SPACE:&1F00")], InGame)).rejects.toThrow(
            "The PC never reached &1234",
        );
    });
});

describe("the scenarios' key steps", () => {
    it("holds playScenario's start keys as long as each step says", async () => {
        const session = recordingSession();
        const scenario = playScenario({
            loaded: [],
            playing: [],
            loadSecs: 1,
            start: ["SPACE:2"],
            inGame: ["game", "main", "loop"],
            moves: ["Z"],
            moments: 0,
        });
        await scenario(context(session));
        expect(session.keys).toEqual([{ key: BBC.SPACE, frames: 100 }]);
    });

    it("presses typedScenario's afterKeys once the keys and keysSecs are done", async () => {
        const session = recordingSession();
        const scenario = typedScenario({
            loaded: [],
            playing: [],
            loadSecs: 1,
            keys: ["SPACE"],
            keysSecs: 10,
            afterKeys: ["RETURN:1"],
            commands: [],
            inGame: ["game", "main", "parse"],
        });
        await scenario(context(session));
        expect(session.keys).toEqual([
            { key: BBC.SPACE, frames: 3 },
            { key: BBC.RETURN, frames: 50 },
        ]);
    });
});
