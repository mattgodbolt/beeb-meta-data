/** The MODE 7 video player's moments for tools/symbols/check-memory.js: as it starts, then as it plays Bad Apple. */

import { runScript, runSeconds } from "../../tools/symbols/check-memory.js";

const PlayMoments = 4;
const PlaySecsPerMoment = 5;

const Player = ["player/code"];

export const scenarios = {
    async play({ session, address, shots, check }) {
        await session.runUntilAddress(address("player", "code", "main"));
        check("the player starting", Player);
        await session.runUntilAddress(address("player", "code", "decode_frame_data"));
        check("the first frame decoding", Player);
        for (let moment = 1; moment <= PlayMoments; moment++) {
            await runSeconds(session, PlaySecsPerMoment);
            check(`playing, moment ${moment}`, Player);
        }
        await runScript(session, ["shot play"], { shots });
    },
};
