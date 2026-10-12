/** By Fair Means or Foul (Enhanced version)'s moments for tools/symbols/check-memory.js. */

import { runSeconds } from "../../tools/symbols/check-memory.js";
import { keyStep, playScenario, pressUntil } from "../../tools/symbols/title-scenario.js";

const Standard = ["page7", "main", "page1", "page4", "paged", "pagef", "page4b"].map(
    (region) => `by-fair-means-or-foul-game/${region}`,
);
// The enhanced version shares all but its main code with the standard version, whose set names it.
const Game = ["game/main", ...Standard.filter((region) => !region.endsWith("/main"))];
const Moves = ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"];

export const titles = ["by-fair-means-or-foul"];

export const machines = { game: { model: "Master" }, shadow: { model: "Master" } };

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: Game,
        loadSecs: 40,
        start: ["Y", "F1"],
        inGame: ["game", "main", "main_game_loop"],
        moves: Moves,
    }),
    // The match information screen's code is in shadow RAM, which a game has paged out.
    shadow: async ({ session, address, check }) => {
        await runSeconds(session, 40);
        await pressUntil(
            session,
            ["Y", "F1"].map((key) => keyStep(key, 50)),
            address("game", "main", "main_game_loop"),
        );
        check("main_game_loop, in a game", Game);
        const belowShadow = Game.filter((region) => !/\/(main|page4b)$/.test(region));
        check("main_game_loop, in shadow RAM", ["shadow/code", ...belowShadow], { shadow: true });
    },
    standard: playScenario({
        loaded: Standard,
        playing: Standard,
        loadSecs: 40,
        start: ["N", "F1"],
        inGame: ["by-fair-means-or-foul-game", "main", "check_nine_keys"],
        moves: Moves,
    }),
};
