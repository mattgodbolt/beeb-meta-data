/**
 * Dunjunz's moments for tools/symbols/check-memory.js on the Model B disc: the title screen, the game
 * loading over it and its core copied down, the hero menu, and random play of the first level.
 * jsbeeb reads a centred joystick, so the game loads its joystick image of page &04-&07.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import {
    holdUntil,
    pressKey,
    pressRandomKeys,
    runScript,
    runSeconds,
    seededRandom,
} from "../../tools/symbols/check-memory.js";

const TitleSecs = 10;
const MenuSecs = 40;
const PlayMoments = 10;
const PlayFramesPerMoment = 150;
const PlaySeed = 1;

const Game = ["game/upper", "game/core", "game/images", "game/heroes", "joystick/handler"];
const PlayKeys = [BBC.Z, BBC.X, BBC.COLON_STAR, BBC.SLASH, BBC.SPACE, BBC.RETURN, BBC.A, BBC.S];

export const scenarios = {
    async play({ session, address, shots, check }) {
        await runSeconds(session, TitleSecs);
        check("the title screen", []);
        await pressKey(session, BBC.SPACE, 5);
        await session.runUntilAddress(address("game", "images", "hero_menu"), MenuSecs);
        check("the hero menu", Game);
        await holdUntil(session, BBC.SPACE, address("game", "core", "play_level"));
        check("the first level", Game);
        const random = seededRandom(PlaySeed);
        for (let moment = 1; moment <= PlayMoments; moment++) {
            await pressRandomKeys(session, PlayKeys, random, PlayFramesPerMoment);
            check(`random play, moment ${moment}`, Game);
        }
        await runScript(session, ["shot play"], { shots });
    },
};
