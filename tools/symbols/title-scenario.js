/**
 * The usual in-memory check of a game, for a title's check module: boot, wait for the game to load,
 * press the keys that start a game until its code runs, then play at random. Most titles need no more
 * than this; their check module is then `export const scenarios = { game: playScenario({...}) }`, or
 * `typedScenario` for a text adventure.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, pressRandomKeys, runScript, runSeconds, seededRandom, typeUntil } from "./check-memory.js";

const StartHoldFrames = 50;
const StartWaitSecs = 2;
const StartTries = 10;
// What jsbeeb's runUntilAddress throws when the time runs out first.
const NotReached = /did not hit appropriate breakpoint/;
const PlayFramesPerMoment = 200;
const PlaySeed = 1;
const PlayMoments = 20;
const KeyGapSecs = 3;
const ReplySecs = 2;

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

/**
 * The same for a text adventure: boot, wait for it to load, press `keys` in turn (pages of
 * instructions, an option), then type each command, checking that the game's code reaches `inGame` as
 * it takes the command.
 * @param {object} options
 * @param {string[]} options.loaded
 * @param {string[]} options.playing
 * @param {number} options.loadSecs
 * @param {string[]} [options.keys] - names of keys in jsbeeb's BBC keymap, each pressed briefly
 * @param {number} [options.keysSecs] - how long the game takes to load after the keys
 * @param {string[]} options.commands
 * @param {[string, string, string]} options.inGame - set, region and name of code that takes a command
 */
export function typedScenario({ loaded, playing, loadSecs, keys = [], keysSecs = 0, commands, inGame }) {
    return async ({ session, address, shots, check }) => {
        check("booting", []);
        await runSeconds(session, loadSecs);
        check("loaded, before a game", loaded);
        await runScript(session, ["shot loaded"], { shots });
        for (const key of keys) {
            await pressKey(session, BBC[key]);
            await runSeconds(session, KeyGapSecs);
        }
        await runSeconds(session, keysSecs);
        for (const command of commands) {
            await typeUntil(session, command, address(...inGame));
            await runSeconds(session, ReplySecs);
            check(`typed ${command}`, playing);
        }
        await runScript(session, ["shot play"], { shots });
    };
}
