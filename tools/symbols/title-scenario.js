/**
 * The usual in-memory check of a game, for a title's check module: boot, wait for the game to load,
 * press the keys that start a game until its code runs, then play at random. Most titles need no more
 * than this; their check module is then `export const scenarios = { game: playScenario({...}) }`, or
 * `typedScenario` for a text adventure.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import {
    FramesPerSecond,
    holdUntil,
    pressKey,
    pressRandomKeys,
    runScript,
    runSeconds,
    seededRandom,
    typeUntil,
} from "./check-memory.js";

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
 * A key step as a scenario's options give it: the name of a key in jsbeeb's BBC keymap, pressed for
 * `frames`; or `NAME:SECS`, held that many seconds, for a loader that only takes a key held a while; or
 * `NAME:&ADDRESS`, held until the PC reaches the address.
 */
export function keyStep(text, frames) {
    const [name, hold] = text.split(":");
    if (BBC[name] === undefined) throw new Error(`There's no key ${name} in jsbeeb's BBC keymap`);
    if (hold === undefined) return { key: BBC[name], frames };
    if (hold.startsWith("&")) return { key: BBC[name], until: parseInt(hold.slice(1), 16) };
    const secs = Number(hold);
    if (!(secs > 0)) throw new Error(`${text} holds ${name} for a number of seconds above 0, or until an &address`);
    return { key: BBC[name], frames: Math.round(secs * FramesPerSecond) };
}

export async function pressStep(session, { key, frames, until }) {
    if (until === undefined) await pressKey(session, key, frames);
    else await holdUntil(session, key, until);
}

/**
 * Takes each step (`keyStep`'s) in turn, again and again, until the PC reaches `address`: a title screen
 * often only reads its keys at some moments, or wants one screen's key and then the next's.
 */
export async function pressUntil(session, steps, address) {
    for (let tries = 0; tries < StartTries; tries++)
        for (const step of steps) {
            await pressStep(session, step);
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
 * @param {string[]} options.start - the key steps (`keyStep`) that start a game
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
            start.map((text) => keyStep(text, StartHoldFrames)),
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
 * instructions, an option), wait `keysSecs` for the game to load, press `afterKeys` (a RETURN once it
 * has), then type each command, checking that the game's code reaches `inGame` as it takes the command.
 * @param {object} options
 * @param {string[]} options.loaded
 * @param {string[]} options.playing
 * @param {number} options.loadSecs
 * @param {string[]} [options.keys] - key steps (`keyStep`), a key name alone pressed briefly
 * @param {number} [options.keysSecs] - how long the game takes to load after the keys
 * @param {string[]} [options.afterKeys] - key steps for once it has
 * @param {string[]} options.commands
 * @param {[string, string, string]} options.inGame - set, region and name of code that takes a command
 */
export function typedScenario({
    loaded,
    playing,
    loadSecs,
    keys = [],
    keysSecs = 0,
    afterKeys = [],
    commands,
    inGame,
}) {
    return async ({ session, address, shots, check }) => {
        check("booting", []);
        await runSeconds(session, loadSecs);
        check("loaded, before a game", loaded);
        await runScript(session, ["shot loaded"], { shots });
        const pressAll = async (texts) => {
            for (const text of texts) {
                await pressStep(session, keyStep(text));
                await runSeconds(session, KeyGapSecs);
            }
        };
        await pressAll(keys);
        await runSeconds(session, keysSecs);
        await pressAll(afterKeys);
        for (const command of commands) {
            await typeUntil(session, command, address(...inGame));
            await runSeconds(session, ReplySecs);
            check(`typed ${command}`, playing);
        }
        await runScript(session, ["shot play"], { shots });
    };
}
