/**
 * Hopper's moments for tools/symbols/check-memory.js: each scenario boots the disc, goes somewhere in
 * the game, and says which regions should match there.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { holdUntil, pressRandomKeys, runSeconds, seededRandom } from "../../tools/symbols/check-memory.js";

const PlayMoments = 20;
const PlayFramesPerMoment = 200;
const PlaySeed = 1;
const LaterSecs = 60;

const Loaded = ["game/main", "game/startup"];
const Relocated = ["game/main", "game/page9", "game/pagec", "game/startup"];
const Game = ["game/main", "game/page9", "game/pagec"];
const Moves = [BBC.Z, BBC.X, BBC.COLON_STAR, BBC.SLASH];

export const scenarios = {
    async game({ session, address, check }) {
        check("booting", []);
        await session.runUntilAddress(address("game", "startup", "entry_point"));
        check("entry_point, the game just loaded", Loaded);
        await session.runUntilAddress(address("game", "pagec", "wait_for_key_or_fire"));
        check("the instructions, waiting for a key", Relocated);
        await holdUntil(session, BBC.SPACE, address("game", "main", "update_game"));
        check("in play", Game);
        const random = seededRandom(PlaySeed);
        for (let moment = 1; moment <= PlayMoments; moment++) {
            await pressRandomKeys(session, Moves, random, PlayFramesPerMoment);
            check(`random play, moment ${moment}`, Game);
        }
        await runSeconds(session, LaterSecs);
        check("a minute later", Game);
    },
};
