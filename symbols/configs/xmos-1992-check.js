/**
 * XMOS (1992)'s moments for tools/symbols/check-memory.js: the ROM its source builds, the original, in a
 * Master's sideways RAM through several commands. xmos-check.js checks it against today's XMOS both ways.
 */

import { runCommands } from "./xmos-check.js";

export const machines = { commands: { model: "Master", autoboot: false } };

export const scenarios = { commands: (context) => runCommands(context, "rom") };
