/**
 * The usual in-memory check of a game, for a title's check module: boot, wait for the game to load,
 * press the keys that start a game until its code runs, then play at random. Most titles need no more
 * than this; their check module is then `export const scenarios = { game: playScenario({...}) }`.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, pressRandomKeys, runScript, runSeconds, seededRandom } from "./check-memory.js";

const StartHoldFrames = 50;
const StartWaitSecs = 2;
const StartTries = 10;
// What jsbeeb's runUntilAddress throws when the time runs out first.
const NotReached = /did not hit appropriate breakpoint/;
const PlayFramesPerMoment = 200;
const PlaySeed = 1;
const PlayMoments = 20;

/**
 * Presses each key in turn, again and again, until the PC reaches `address`: a title screen often
 * only reads its keys at some moments, or wants one screen's key and then the next's.
 */
export async function pressUntil(session, keys, address) {
    for (let tries = 0; tries < StartTries; tries++)
        for (const key of keys) {
            await pressKey(session, key, StartHoldFrames);
            try {
                await session.runUntilAddress(address, StartWaitSecs);
                return;
            } catch (error) {
                if (!NotReached.test(error.message)) throw error;
            }
        }
    throw new Error(`The PC never reached &${address.toString(16).toUpperCase()} for those keys`);
}

/**
 * @param {object} options
 * @param {string[]} options.loaded - the regions that match once the game has loaded, before a game
 * @param {string[]} options.playing - the regions that match in a game
 * @param {number} options.loadSecs - how long the disc takes to load the game
 * @param {string[]} options.start - names of keys in jsbeeb's BBC keymap that start a game
 * @param {[string, string, string]} options.inGame - set, region and name of code that only runs in a game
 * @param {string[]} options.moves - names of the keys to play with
 * @param {number} [options.moments]
 */
export function playScenario({ loaded, playing, loadSecs, start, inGame, moves, moments = PlayMoments }) {
    return async ({ session, address, shots, check }) => {
        check("booting", []);
        await runSeconds(session, loadSecs);
        check("loaded, before a game", loaded);
        await runScript(session, ["shot loaded"], { shots });
        await pressUntil(
            session,
            start.map((key) => BBC[key]),
            address(...inGame),
        );
        check(`${inGame[2]}, in a game`, playing);
        const random = seededRandom(PlaySeed);
        for (let moment = 1; moment <= moments; moment++) {
            await pressRandomKeys(
                session,
                moves.map((key) => BBC[key]),
                random,
                PlayFramesPerMoment,
            );
            check(`random play, moment ${moment}`, playing);
        }
        await runScript(session, ["shot play"], { shots });
    };
}
