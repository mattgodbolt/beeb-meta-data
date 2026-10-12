/**
 * Frogman's moments for tools/symbols/check-memory.js: the rebuilt disc on a Master through the credits,
 * the title screen and play on both levels, the same on a B, and the original 1993 disc, whose
 * encrypted loader leaves the same code in memory.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { holdUntil, pressKey, pressRandomKeys, runSeconds, seededRandom } from "../../tools/symbols/check-memory.js";

const CreditsSecs = 3;
const TitleSecs = 2;
const OriginalLoaderSecs = 25;
const PlayMoments = 6;
const PlayFramesPerMoment = 150;
const PlaySeed = 1;

const Game = ["game/engine", "game/game"];
const Setup = ["setup/setup"];
const PlayKeys = [BBC.Z, BBC.X, BBC.COLON_STAR, BBC.SLASH];

async function play({ session, address, check }, level) {
    await runSeconds(session, CreditsSecs);
    check("the credits and level select", []);
    await pressKey(session, level === 1 ? BBC.K1 : BBC.K2, 5);
    await session.runUntilAddress(address("setup", "setup", "setup_entry"));
    check("the title screen starting", Setup);
    await runSeconds(session, TitleSecs);
    check("the title screen", Setup);
    await holdUntil(session, BBC.SPACE, address("game", "game", "game_init"));
    check("the game loaded over the title screen", ["game/game", ...Setup]);
    await runSeconds(session, TitleSecs);
    check(`level ${level}'s first screen`, Game);
    await randomPlay({ session, address, check });
}

async function randomPlay({ session, address, check }) {
    await holdUntil(session, BBC.SPACE, address("game", "game", "main_loop"));
    check("the main loop", Game);
    const random = seededRandom(PlaySeed);
    for (let moment = 1; moment <= PlayMoments; moment++) {
        await pressRandomKeys(session, PlayKeys, random, PlayFramesPerMoment);
        check(`random play, moment ${moment}`, Game);
    }
}

export const machines = {
    level1: { model: "Master" },
    level2: { model: "Master" },
    modelB: {},
    original: { model: "Master", disc: "frogman.ssd" },
};

export const scenarios = {
    level1: (context) => play(context, 1),
    level2: (context) => play(context, 2),
    modelB: (context) => play(context, 1),
    async original(context) {
        const { session, address, check } = context;
        await runSeconds(session, CreditsSecs);
        check("the original's credits and level select", []);
        await pressKey(session, BBC.K1, 5);
        await runSeconds(session, OriginalLoaderSecs);
        check("the original's loader and title screen", []);
        await holdUntil(session, BBC.SPACE, address("game", "game", "game_init"));
        check("the original's game loaded", ["game/game"]);
        await runSeconds(session, TitleSecs);
        check("the original's first screen", Game);
        await randomPlay(context);
    },
};
