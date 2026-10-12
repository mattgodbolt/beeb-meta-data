#!/usr/bin/env node
/**
 * Lays out what the site serves under meta/: the symbol index and every set it lists, nothing else.
 *
 * Usage: node tools/dist.js
 */

import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseIndex } from "jsbeeb/src/symbol-sets.js";

import { SymbolsDir } from "./symbols/build-index.js";

export const SymbolsPath = "meta/symbols";
const DistDir = fileURLToPath(new URL("../dist/", import.meta.url));

/** Copies the index and its sets from `symbolsDir` into `out`; returns the paths written, relative to `out`. */
export function writeDist(symbolsDir, out) {
    const index = JSON.parse(readFileSync(path.join(symbolsDir, "index.json"), "utf8"));
    const files = ["index.json", ...parseIndex(index).map(({ url }) => url)];
    rmSync(out, { recursive: true, force: true });
    for (const file of files) {
        const to = path.join(out, SymbolsPath, file);
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(path.join(symbolsDir, file), to);
    }
    return files.map((file) => `${SymbolsPath}/${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const written = writeDist(SymbolsDir, DistDir);
    console.log(`Wrote ${written.length} files under ${path.join(DistDir, SymbolsPath)}`);
}
