/** By Fair Means or Foul (Enhanced version)'s moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

const Standard = ["page7", "main", "page1", "page4", "paged", "pagef", "page4b"].map(
    (region) => `by-fair-means-or-foul-game/${region}`,
);
// The enhanced version shares all but its main code with the standard version, whose set names it.
const Game = ["game/main", ...Standard.filter((region) => !region.endsWith("/main"))];
const Moves = ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"];

export const titles = ["by-fair-means-or-foul"];

export const machines = { game: { model: "Master" } };

export const scenarios = {
    game: playScenario({
        loaded: [],
        playing: Game,
        loadSecs: 40,
        start: ["Y", "F1"],
        inGame: ["game", "main", "main_game_loop"],
        moves: Moves,
    }),
    standard: playScenario({
        loaded: Standard,
        playing: Standard,
        loadSecs: 40,
        start: ["N", "F1"],
        inGame: ["by-fair-means-or-foul-game", "main", "check_nine_keys"],
        moves: Moves,
    }),
};
