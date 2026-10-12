/**
 * Plan B's moments for tools/symbols/check-memory.js: the loader, the title, and play.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { holdUntil, pressRandomKeys, runSeconds, seededRandom } from "../../tools/symbols/check-memory.js";

const PlayMoments = 20;
const PlayFramesPerMoment = 200;
const PlaySeed = 1;

const Game = ["game/main"];
const Keys = [BBC.Z, BBC.X, BBC.SHIFT, BBC.RETURN, BBC.SPACE];

export const scenarios = {
    async game({ session, address, check }) {
        await runSeconds(session, 1);
        check("loading", []);
        await session.runUntilAddress(address("game", "main", "entry_point"));
        check("entry_point, the game just loaded", Game);
        await session.runUntilAddress(address("game", "main", "wait_for_space_loop"));
        check("the title, waiting for SPACE", Game);
        await holdUntil(session, BBC.SPACE, address("game", "main", "main_loop"));
        check("in play", Game);
        const random = seededRandom(PlaySeed);
        for (let moment = 1; moment <= PlayMoments; moment++) {
            await pressRandomKeys(session, Keys, random, PlayFramesPerMoment);
            check(`random play, moment ${moment}`, Game);
        }
    },
};
