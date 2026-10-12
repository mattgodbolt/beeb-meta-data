#!/usr/bin/env node
/**
 * Runs every config's importer, then build-index.js, and lists the set files that changed. A change to a
 * system set changes what other titles leave to it, so after one every set has to be remade to stay
 * reproducible; this is that, and with `--check` a test that nothing changed.
 *
 * Usage: node tools/symbols/reimport-all.js [--check] [CONFIG...]
 *
 * The importers find their tools as they always do (BARON, BEEBASM, ACME, PYTHON), and fetch their sources.
 * Exits 1 if an importer fails, or, with `--check`, if any set file changed.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { SymbolsDir } from "./build-index.js";

const ConfigsDir = path.join(SymbolsDir, "configs");
const SetsDir = path.join(SymbolsDir, "sets");
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

const readSetFiles = () =>
    new Map(
        readdirSync(SetsDir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => [name, readFileSync(path.join(SetsDir, name), "utf8")]),
    );

/** The set files added, removed or changed between two readings. */
export function changedSets(before, after) {
    return [...new Set([...before.keys(), ...after.keys()])]
        .filter((name) => before.get(name) !== after.get(name))
        .sort();
}

function main() {
    const { values, positionals } = parseArgs({
        options: { check: { type: "boolean", default: false } },
        allowPositionals: true,
    });
    const configs = positionals.length
        ? positionals
        : readdirSync(ConfigsDir)
              .filter((name) => name.endsWith(".json"))
              .sort()
              .map((name) => path.join(ConfigsDir, name));
    const before = readSetFiles();
    const failed = [];
    for (const file of configs) {
        const script = importerScript(JSON.parse(readFileSync(file, "utf8")));
        console.log(`-- ${path.basename(file)} (${script})`);
        const run = spawnSync(process.execPath, [path.join(ToolsDir, script), "--config", file], { stdio: "inherit" });
        if (run.status !== 0) failed.push(path.basename(file));
    }
    const index = spawnSync(process.execPath, [path.join(ToolsDir, "build-index.js")], { stdio: "inherit" });
    const changed = changedSets(before, readSetFiles());
    console.log(changed.length ? `Changed: ${changed.join(", ")}` : "No set changed");
    if (failed.length) console.error(`Failed: ${failed.join(", ")}`);
    return failed.length || index.status !== 0 || (values.check && changed.length) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
