/**
 * Warlord's moments for tools/symbols/check-memory.js: the game from the Acorn User disc's menu, then a
 * walk to each overlay the disc holds, typing a command at a time.
 */

import { BBC } from "jsbeeb/src/keymap.js";
import { pressKey, runScript, runSeconds, typeUntil } from "../../tools/symbols/check-memory.js";

const MenuSecs = 20;
const KeyFrames = 10;
const PageSecs = [15, 30, 10, 10];
const ReplyLimitSecs = 20;
// p["cubix_state"]: 2 opens the Cubix's door, which takes meeting the king and a radio call to Tim.
const CubixState = 0x04b6;
const CubixOpen = 2;

const Game = ["game/high", "game/low", "game/page8"];
const Overlay1 = [...Game, "overlay1/actions", "overlay1/descriptions"];
const Overlay2 = [...Game, "overlay2/main"];
const Overlay3 = [...Game, "overlay3/main"];

const ToTheGatehouse = ["east", "north", "north", ...Array(8).fill("east")];
const ToTheCubix = ["west", "west", "west", "west", "south", "south", "south", "southeast", "east"];

export const scenarios = {
    async game({ session, address, shots, check }) {
        const processInput = address("game", "low", "process_input");
        const prompt = address("game", "low", "main_game_loop");
        const type = async (commands) => {
            for (const command of commands) {
                await typeUntil(session, command, processInput);
                await session.runUntilAddress(prompt, ReplyLimitSecs);
            }
        };
        check("booting", []);
        await runSeconds(session, MenuSecs);
        check("the disc's menu", []);
        for (const secs of PageSecs) {
            await pressKey(session, BBC.RETURN, KeyFrames);
            await runSeconds(session, secs);
        }
        check("in a game, by the tall tree", Overlay1);
        await type(["look", "inventory"]);
        check("typed look and inventory", Overlay1);
        await type(ToTheGatehouse);
        check("at the western gatehouse", Overlay2);
        await type(["wait", "west"]);
        check("back on the road", Overlay1);
        session.writeMemory(CubixState, [CubixOpen]);
        await type(ToTheCubix);
        check("in the Cubix", Overlay3);
        await runScript(session, ["shot play"], { shots });
    },
};
