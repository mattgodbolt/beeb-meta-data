#!/usr/bin/env node
/**
 * Prints what a title's config needs about a disc in the corpus: its `disc` entry (the published copy's URL, the
 * image's path in the zip, and its key), and each DFS file on it with where it loads and runs, which is where to
 * start looking for the title's regions.
 *
 * Usage: node tools/symbols/disc-entry.js <corpus path of a zip, such as sth-disc/AnF/ChuckieEgg.zip>
 *            [--corpus .registry-corpus]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { unzip } from "jsbeeb/src/archive.js";
import { dfsCatalogue } from "../registry/dfs.js";
import { fingerprint, imageSides, isDiscImage } from "../registry/fingerprint.js";

const Mirrors = {
    "sth-disc": "https://bbc.xania.org/archive/sth/diskimages/",
};
const hex = (value) => `&${value.toString(16).toUpperCase().padStart(4, "0")}`;

/** The URL of the published copy of the corpus file at `ref` (`sth-disc/<path>`). */
export function publishedUrl(ref) {
    const [mirror, ...rest] = ref.split("/");
    if (!Mirrors[mirror] || !rest.length)
        throw new Error(`${ref} isn't a file under ${Object.keys(Mirrors).join(", ")}`);
    return Mirrors[mirror] + rest.map(encodeURIComponent).join("/");
}

/**
 * Each disc image in a zip, with the config's `disc` entry for it and its DFS files.
 * @param {string} url - where the zip is published
 * @param {Record<string, Uint8Array>} members - the zip's files, by path
 */
export function discEntries(url, members) {
    return Object.entries(members)
        .filter(([image]) => isDiscImage(image))
        .map(([image, bytes]) => ({
            disc: { url, image, key: fingerprint(image, bytes).discKey },
            files: imageSides(image, bytes).sides.flatMap((side) => dfsCatalogue(side)?.files ?? []),
        }));
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: { corpus: { type: "string", default: ".registry-corpus" } },
    });
    if (positionals.length !== 1) throw new Error("Usage: disc-entry.js <corpus path of a zip> [--corpus <dir>]");
    const [ref] = positionals;
    const members = await unzip(readFileSync(path.join(values.corpus, ref)));
    for (const { disc, files } of discEntries(publishedUrl(ref), members)) {
        console.log(JSON.stringify({ disc }, null, 2));
        for (const { name, load, exec, length } of files)
            console.log(`  ${name.padEnd(10)} load ${hex(load)} exec ${hex(exec)} length ${hex(length)}`);
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error.message);
            process.exit(1);
        },
    );
}
