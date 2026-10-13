#!/usr/bin/env node
/**
 * Prints what a title's config needs about a disc or tape: its `disc` or `tape` entry (the published copy's URL, the
 * image's path in the zip, and its key), and each file on it with where it loads and runs, which is where to start
 * looking for the title's regions.
 *
 * Usage: node tools/symbols/image-entry.js <sth-disc/... or sth-tape/... zip> [--corpus .registry-corpus]
 *        node tools/symbols/image-entry.js <a local .ssd, .dsd, .uef or a zip of them>
 *
 * A path under one of the corpus's mirrors is read from the corpus and given the mirror's URL; any other path is read
 * as it is, and gets no URL (a disc in a title's own repository, say, which its config names by path).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { unzip } from "jsbeeb/src/archive.js";
import { dfsCatalogue } from "../registry/dfs.js";
import { fingerprint, imageSides, isDiscImage } from "../registry/fingerprint.js";
import { decodeTape, tapeKey } from "../registry/tape.js";

const Mirrors = {
    "sth-disc": "https://bbc.xania.org/archive/sth/diskimages/",
    "sth-tape": "https://bbc.xania.org/archive/sth/tapeimages/",
};
const TapeImage = /\.uef$/i;
const ZipFile = /\.zip$/i;
const HostAddressBits = 0x30000;

/** A file's load or exec address as DFS and tape headers mean it: &FFFFxxxx for the host, where the top bits are set. */
export const showAddress = (value) =>
    (value & HostAddressBits) === HostAddressBits
        ? `&FFFF${(value & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`
        : `&${value.toString(16).toUpperCase().padStart(4, "0")}`;

/** The URL of the published copy of the corpus file at `ref` (`sth-disc/<path>` or `sth-tape/<path>`), or null. */
export function publishedUrl(ref) {
    const [mirror, ...rest] = ref.split("/");
    return Mirrors[mirror] && rest.length ? Mirrors[mirror] + rest.map(encodeURIComponent).join("/") : null;
}

/**
 * Each disc and tape image among `members` (path to bytes), with the config's entry for it and its files: a disc's by
 * side, from its DFS catalogue, and a tape's in order.
 * @param {string | null} url - where the zip is published, if it is
 */
export function imageEntries(url, members) {
    return Object.entries(members).flatMap(([image, bytes]) => {
        if (TapeImage.test(image)) {
            const { files } = decodeTape(bytes);
            return [{ kind: "tape", entry: { url, image, key: tapeKey(files) }, sides: [files] }];
        }
        if (!isDiscImage(image)) return [];
        const sides = imageSides(image, bytes).sides.map((side) => dfsCatalogue(side)?.files ?? null);
        return [{ kind: "disc", entry: { url, image, key: fingerprint(image, bytes).discKey }, sides }];
    });
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: { corpus: { type: "string", default: ".registry-corpus" } },
    });
    if (positionals.length !== 1) throw new Error("Usage: image-entry.js <corpus path or file> [--corpus <dir>]");
    const [ref] = positionals;
    const url = publishedUrl(ref);
    const file = url ? path.join(values.corpus, ref) : ref;
    if (!existsSync(file))
        throw new Error(`There's no ${file}${url ? "; is the corpus fetched, or elsewhere (--corpus)?" : ""}`);
    const bytes = readFileSync(file);
    const members = ZipFile.test(file) ? await unzip(bytes) : { [path.basename(file)]: bytes };
    const entries = imageEntries(url, members);
    if (!entries.length) throw new Error(`${ref} holds no disc or tape image`);
    for (const { kind, entry, sides } of entries) {
        console.log(JSON.stringify({ [kind]: url ? entry : { image: entry.image, key: entry.key } }, null, 2));
        sides.forEach((files, side) => {
            if (sides.length > 1) console.log(`  side ${side}${files ? "" : ": not a DFS catalogue"}`);
            else if (!files) console.log("  not a DFS catalogue");
            for (const { name, load, exec, length } of files ?? [])
                console.log(
                    `  ${name.padEnd(10)} load ${showAddress(load)} exec ${showAddress(exec)} length &${length.toString(16).toUpperCase()}`,
                );
        });
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
