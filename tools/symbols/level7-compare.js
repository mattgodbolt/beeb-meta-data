#!/usr/bin/env node
/**
 * For choosing a level7 title's regions: boots the disc a config names in a headless jsbeeb, runs it a
 * while (pressing keys if asked), and says how much of each run of the disassembly's statements memory
 * holds there, so the curator sees which pieces the disc really runs and where. The disassembly is
 * often of the tape version, and a disc can load or relocate it differently.
 *
 * Usage: node tools/symbols/level7-compare.js --config symbols/configs/hopper.json [--source <file>]
 *            [--seconds 25] [--keys SPACE,RETURN]
 *
 * The config needs only `source` and `disc`; KEYS are names in jsbeeb's BBC keymap, each pressed in
 * turn with three seconds after it.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { BBC } from "jsbeeb/src/keymap.js";
import { fetchDisc, pressKey, runSeconds, startMachine } from "./check-memory.js";
import { hex, level7Text } from "./import-level7.js";
import { readLevel7 } from "./level7-text.js";

const MemoryTop = 0x8000;
const SecondsAfterKey = 3;
const KeyFrames = 5;
const ShortestRun = 16;

/**
 * Each part's runs of consecutive statements, with how many of their bytes below &8000 `peek` agrees
 * with, leaving out bytes the disassembly says change as the program runs.
 * @returns {{part: string, runs: {start: number, end: number, line: number, held: number, same: number}[]}[]}
 */
export function compareWithMemory(parts, peek) {
    return parts.map((part) => {
        const runs = [];
        let run = null;
        for (const statement of part.statements) {
            if (!run || statement.address !== run.end) {
                run = { start: statement.address, end: statement.address, line: statement.line, held: 0, same: 0 };
                runs.push(run);
            }
            run.end = statement.address + statement.data.length;
            if (statement.modified) continue;
            statement.data.forEach((byte, i) => {
                const at = statement.address + i;
                if (at >= MemoryTop) return;
                run.held++;
                if (peek(at) === byte) run.same++;
            });
        }
        return { part: part.name, runs };
    });
}

async function main() {
    const { values } = parseArgs({
        options: {
            config: { type: "string" },
            source: { type: "string" },
            seconds: { type: "string", default: "25" },
            keys: { type: "string", default: "" },
        },
    });
    if (!values.config)
        throw new Error("Usage: level7-compare.js --config <file> [--source <file>] [--seconds N] [--keys K,K]");
    const config = JSON.parse(readFileSync(values.config, "utf8"));
    const { parts } = readLevel7(await level7Text(config, values.source));
    const temp = mkdtempSync(path.join(tmpdir(), "symbols-level7-"));
    try {
        const disc = path.join(temp, path.basename(config.disc.image));
        writeFileSync(disc, await fetchDisc(config.disc));
        const session = await startMachine(disc);
        try {
            await runSeconds(session, parseFloat(values.seconds));
            for (const key of values.keys.split(",").filter(Boolean)) {
                if (BBC[key] === undefined) throw new Error(`There's no key ${key} in jsbeeb's BBC keymap`);
                await pressKey(session, BBC[key], KeyFrames);
                await runSeconds(session, SecondsAfterKey);
            }
            const memory = session.readMemory(0, MemoryTop);
            console.log(`PC ${hex(session.registers().pc)}`);
            for (const { part, runs } of compareWithMemory(parts, (at) => memory[at])) {
                console.log(`${part}:`);
                for (const { start, end, line, held, same } of runs.filter((r) => r.end - r.start >= ShortestRun))
                    console.log(
                        `    ${hex(start)}-${hex(end - 1)} (line ${line}): ${held ? Math.round((100 * same) / held) : 0}%`,
                    );
            }
        } finally {
            session.destroy();
        }
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error.stack ?? error.message);
            process.exit(1);
        },
    );
}
