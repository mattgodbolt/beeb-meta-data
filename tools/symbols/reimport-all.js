#!/usr/bin/env node
/**
 * Runs every config's importer, then build-index.js, and lists the set files that changed. A change to a
 * system set changes what other titles leave to it, so after one every set has to be remade to stay
 * reproducible; this is that, and with `--check` a test that nothing changed.
 *
 * Usage: node tools/symbols/reimport-all.js [--check] [CONFIG...]
 *
 * The importers find their tools as they always do (BARON, BEEBASM, ACME, PYTHON), and fetch their sources.
 * System sets' configs run first, since the others leave the system sets' addresses to them. With `--check`,
 * it compares the set files with what they were when it started, and exits 1 if any changed; it exits 1 too if
 * an importer fails or a config's importer isn't known.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { SymbolsDir } from "./build-index.js";

export const ConfigsDir = path.join(SymbolsDir, "configs");
export const SetsDir = path.join(SymbolsDir, "sets");
const ToolsDir = fileURLToPath(new URL(".", import.meta.url));
const ByImporter = {
    acornaeology: "import-acornaeology.js",
    acme: "import-acme.js",
    level7: "import-level7.js",
};

/** The importer script that makes a config's sets. */
export function importerScript(config) {
    if (config.importer !== undefined) {
        const script = ByImporter[config.importer];
        if (!script) throw new Error(`${config.id} is for the ${config.importer} importer, which isn't known`);
        return script;
    }
    if (config.py8dis) return "import-py8dis.js";
    return config.source?.assembler === "beebasm" ? "import-beebasm.js" : "import-baron.js";
}

/** Every set file's text, by its name. */
export const readSetFiles = () =>
    new Map(
        readdirSync(SetsDir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => [name, readFileSync(path.join(SetsDir, name), "utf8")]),
    );

/** The configs with system sets' first, each group in its order. */
export const systemFirst = (configs) => [
    ...configs.filter(({ config }) => config.system),
    ...configs.filter(({ config }) => !config.system),
];

/** The set files added, removed or changed between two readings. */
export function changedSets(before, after) {
    return [...new Set([...before.keys(), ...after.keys()])]
        .filter((name) => before.get(name) !== after.get(name))
        .sort();
}

/** Every config file's path, in order. */
export const configFiles = () =>
    readdirSync(ConfigsDir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => path.join(ConfigsDir, name));

/** Runs the importer for the config in `file`, and says whether it succeeded. */
export function runImporter(file, config, spawnOptions = { stdio: "inherit" }) {
    const script = importerScript(config);
    console.log(`-- ${path.basename(file)} (${script})`);
    return spawnSync(process.execPath, [path.join(ToolsDir, script), "--config", file], spawnOptions);
}

function main() {
    const { values, positionals } = parseArgs({
        options: { check: { type: "boolean", default: false } },
        allowPositionals: true,
    });
    const configs = positionals.length ? positionals : configFiles();
    const before = readSetFiles();
    const failed = [];
    const read = configs.map((file) => ({ file, config: JSON.parse(readFileSync(file, "utf8")) }));
    for (const { file, config } of systemFirst(read)) {
        let run;
        try {
            run = runImporter(file, config);
        } catch (error) {
            console.error(error.message);
            failed.push(path.basename(file));
            continue;
        }
        if (run.status !== 0) failed.push(path.basename(file));
    }
    const index = spawnSync(process.execPath, [path.join(ToolsDir, "build-index.js")], { stdio: "inherit" });
    const changed = changedSets(before, readSetFiles());
    console.log(changed.length ? `Changed: ${changed.join(", ")}` : "No set changed");
    if (failed.length) console.error(`Failed: ${failed.join(", ")}`);
    return failed.length || index.status !== 0 || (values.check && changed.length) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
