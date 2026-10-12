/**
 * jsbeeb's ROMs, as the importers of a ROM's set use them: the image key of the ROM a set is made from, and
 * every other ROM's banks, which the set's anchors must tell apart.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { RomsDir } from "../jsbeeb.js";

const KeyHexDigits = 32;
const CopyWindow = 8;

/** A ROM's image key, as `madeFrom` lists it. */
export const romKey = (rom) => createHash("sha256").update(rom).digest("hex").slice(0, KeyHexDigits);

/**
 * Every file under jsbeeb's public/roms/ that holds one or more whole banks the ROM's size, but the ROM.
 * @returns {{name: string, bytes: Uint8Array}[]}
 */
export function otherRomsThan(romFile, size) {
    const files = readdirSync(RomsDir, { recursive: true })
        .map(String)
        .filter((name) => name !== romFile && statSync(path.join(RomsDir, name)).isFile())
        .sort();
    return files
        .map((name) => ({ name, bytes: readFileSync(path.join(RomsDir, name)) }))
        .filter(({ bytes }) => bytes.length > 0 && bytes.length % size === 0);
}

/** Every bank the ROM's size of the other ROMs, placed where the ROM runs, as the anchor chooser's images. */
export function romImages(otherRoms, base, size) {
    return otherRoms.flatMap(({ name, bytes }) =>
        Array.from({ length: Math.floor(bytes.length / size) }, (_, bank) => ({
            name: bytes.length > size ? `${name} bank ${bank}` : name,
            memory: new Map(Array.from({ length: size }, (_, i) => [base + i, bytes[bank * size + i]])),
            program: false,
        })),
    );
}

/**
 * Where each bank of the other ROMs holds its own copy of code the ROM moves out of itself to run (a
 * Tube host or an NMI handler, say), placed where that code runs: the bank's bytes from the offset
 * the most runs of CopyWindow bytes agree on. A bank sharing no such run with the code holds no copy.
 * @param {Map<number, number>} moved - the code's bytes where it runs
 */
export function romCopies(otherRoms, size, moved) {
    const start = Math.min(...moved.keys());
    const code = Buffer.from(
        Array.from({ length: Math.max(...moved.keys()) + 1 - start }, (_, i) => moved.get(start + i) ?? 0),
    );
    const out = [];
    for (const { name, bytes } of otherRoms) {
        for (let bank = 0; bank * size < bytes.length; bank++) {
            const image = Buffer.from(bytes.subarray(bank * size, (bank + 1) * size));
            const votes = new Map();
            for (let i = 0; i + CopyWindow <= code.length; i++) {
                const run = code.subarray(i, i + CopyWindow);
                for (let at = image.indexOf(run); at >= 0; at = image.indexOf(run, at + 1))
                    votes.set(at - i, (votes.get(at - i) ?? 0) + 1);
            }
            if (!votes.size) continue;
            const [offset] = [...votes].reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a));
            const memory = new Map(
                [...moved.keys()]
                    .filter((address) => offset + address - start >= 0 && offset + address - start < image.length)
                    .map((address) => [address, image[offset + address - start]]),
            );
            out.push({ name: `${bytes.length > size ? `${name} bank ${bank}` : name}'s copy`, memory, program: false });
        }
    }
    return out;
}

/**
 * Fetches a ROM jsbeeb doesn't have, refusing it unless its key is `key`.
 * @returns {Promise<Uint8Array>}
 */
export async function fetchRom({ url, key }) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetching ${url} failed with ${response.status}`);
    const rom = new Uint8Array(await response.arrayBuffer());
    if (romKey(rom) !== key) throw new Error(`${url} is ROM ${romKey(rom)}, and the config names ${key}`);
    return rom;
}

/** A ROM a config names: jsbeeb's file, or a copy by URL and key. */
export const romOf = async (rom) =>
    typeof rom === "string" ? new Uint8Array(readFileSync(path.join(RomsDir, rom))) : fetchRom(rom);
