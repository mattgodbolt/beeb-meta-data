#!/usr/bin/env node
/**
 * Prints what a title's config needs about a disc or tape: its `disc` or `tape` entry (the published copy's URL, the
 * image's path in the zip, and its key), and each file on it with where it loads and runs, which is where to start
 * looking for the title's regions.
 *
 * Usage: node tools/symbols/image-entry.js <sth-disc/... or sth-tape/... zip> [--corpus .registry-corpus]
 *        node tools/symbols/image-entry.js <a local .ssd, .dsd, .uef or a zip of them>
 *
 * A path under the corpus's sth-disc or sth-tape is read from the corpus and given its mirror's URL; any other path is
 * read as it is, and gets no URL (a disc in a title's own repository, say, which its config names by path).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { unzip } from "jsbeeb/src/archive.js";
import { dfsCatalogue } from "../registry/dfs.js";
import { fingerprint, imageSides, isDiscImage } from "../registry/fingerprint.js";
import { publishedUrl } from "../registry/mirrors.js";
import { decodeTape, tapeKey } from "../registry/tape.js";

const ImageMirrors = ["sth-disc", "sth-tape"];
const TapeImage = /\.uef$/i;
const ZipFile = /\.zip$/i;
const HostAddressBits = 0x30000;

/** A file's load or exec address as DFS and tape headers mean it: &FFFFxxxx for the host, where the top bits are set. */
export const showAddress = (value) =>
    (value & HostAddressBits) === HostAddressBits
        ? `&FFFF${(value & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`
        : `&${value.toString(16).toUpperCase().padStart(4, "0")}`;

/** A path's part from its mirror's directory on (`sth-disc/<path>`), however it's written, or null if it has none. */
export function corpusRef(file) {
    const parts = file.split(path.sep).join("/").split("/");
    const at = parts.findIndex((part) => ImageMirrors.includes(part));
    return at >= 0 && at < parts.length - 1 ? parts.slice(at).join("/") : null;
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
    const [given] = positionals;
    const ref = existsSync(given) ? (corpusRef(given) ?? given) : given;
    const url = publishedUrl(ref);
    const file = existsSync(given) ? given : path.join(values.corpus, ref);
    if (!existsSync(file))
        throw new Error(`There's no ${file}${url ? "; is the corpus fetched, or elsewhere (--corpus)?" : ""}`);
    if (statSync(file).isDirectory()) throw new Error(`${file} is a directory; name a zip or an image in it`);
    const bytes = readFileSync(file);
    const members = ZipFile.test(file) ? await unzip(bytes) : { [path.basename(file)]: bytes };
    const entries = imageEntries(url, members);
    if (!entries.length) throw new Error(`${ref} holds no disc or tape image`);
    for (const { kind, entry, sides } of entries) {
        if (url) console.log(JSON.stringify({ [kind]: entry }, null, 2));
        else
            console.log(
                `${entry.image}: key ${entry.key}. It isn't in the corpus, so it has no URL: for a title's own image, ` +
                    "its path goes in source.disc and this key in madeFrom.",
            );
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
