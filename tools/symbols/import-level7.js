#!/usr/bin/env node
/**
 * Makes a title's symbol sets from one of the disassemblies at https://www.level7.org.uk/miscellany/,
 * plain text that level7-text.js reads: each part of it (a file, or what a heading starts) with its
 * statements' addresses and bytes, its labels, and the names its operands are given. A curator's config
 * under symbols/configs/ says which parts make a set and where they're cut into regions;
 * docs/symbol-importers.md says how the names and anchors are chosen.
 *
 * Usage: node tools/symbols/import-level7.js --config symbols/configs/hopper.json [--source <file>]
 *            [--out symbols/sets] [--verbose]
 *
 * Fetches the config's `source.disassembly`, or reads `--source`, a copy of it, and refuses it unless its
 * SHA-256 is the config's. Writes <config id>-<set id>.json for each set, then
 * `node tools/symbols/build-index.js` remakes the index.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Format } from "jsbeeb/src/symbol-sets.js";
import { chooseAnchors, storesIn } from "./anchor-chooser.js";
import { SymbolsDir, systemGlobals } from "./build-index.js";
import { byAddress, evaluate, hexAddress, writeTitle } from "./import-baron.js";
import { readLevel7 } from "./level7-text.js";

const SetsDir = path.join(SymbolsDir, "sets");
export const Level7 = "level7";
export const Level7Options = { source: { type: "string" } };
export const Level7Usage = "[--source <file>]";

const Permission = /^The author of this disassembly imposes no additional copyright restrictions\b/;
const MoveNote = /^# &[0-9a-f]{4} - &[0-9a-f]{4} is (?:moved|copied|decrypted|relocated)\b.* at &([0-9a-f]{4})\s*$/i;
const GlobalsLimit = 0x8000;
const FragmentSafe = /[A-Za-z0-9_.~]/;
const WordCharacter = /[A-Za-z0-9_]/;
const SuffixWords = 4;

export const hex = (address) => `&${address.toString(16).toUpperCase().padStart(4, "0")}`;
const holds = (range, address) => address >= range.start && address < range.end;

/** The author's statement of what they allow, a paragraph of its own near the top of every disassembly. */
export function permissionOf(text) {
    const paragraphs = text.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim().split(/\s+/).join(" "));
    const found = paragraphs.find((paragraph) => Permission.test(paragraph));
    if (!found) throw new Error("The disassembly doesn't say what its author allows");
    return found;
}

/** The addresses a `# &3200 - &33ff is copied to &0900 - &0aff at &3011` note says copy a piece into place. */
export function noteMoves(text) {
    return text.split(/\r\n|\r|\n/).flatMap((line) => {
        const match = MoveNote.exec(line);
        return match ? [parseInt(match[1], 16)] : [];
    });
}

const encodeFragment = (text) =>
    [...text]
        .map((c) => (FragmentSafe.test(c) ? c : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`))
        .join("");

/**
 * Where a text fragment's `text=` directive first matches in a plain text document, by its start's
 * offset: `start` as a whole word, ignoring case, then, if given, `suffix` after nothing but whitespace.
 */
function firstMatch(lower, start, suffix) {
    const isWord = (at) => at >= 0 && at < lower.length && WordCharacter.test(lower[at]);
    for (let at = lower.indexOf(start); at >= 0; at = lower.indexOf(start, at + 1)) {
        if (isWord(at - 1) || isWord(at + start.length)) continue;
        if (suffix === undefined) return at;
        let after = at + start.length;
        while (/\s/.test(lower[after] ?? "")) after++;
        if (lower.startsWith(suffix, after) && !isWord(after + suffix.length)) return at;
    }
    return -1;
}

/**
 * A `#:~:text=` fragment that takes a browser to `name` at `offset` in the document, or undefined if
 * neither the name alone nor the name followed by the next few words of its line gets there first.
 */
export function textFragment(text, lower, name, offset) {
    const start = name.toLowerCase();
    if (firstMatch(lower, start, undefined) === offset) return `:~:text=${encodeFragment(name)}`;
    const after = text.slice(offset + name.length);
    const rest = /^[ \t]*([^\r\n]*)/.exec(after)[1].trimEnd();
    const words = rest ? rest.split(" ") : [/^\s*(\S*)/.exec(after)[1]];
    for (let count = 1; count <= Math.min(SuffixWords, words.length); count++) {
        if (words[count - 1] === "") return undefined;
        const suffix = words.slice(0, count).join(" ");
        if (firstMatch(lower, start, suffix.toLowerCase()) === offset)
            return `:~:text=${encodeFragment(name)},-${encodeFragment(suffix)}`;
    }
    return undefined;
}

/** The offset in `text` of each line's start, so line 1 is at offsets[1]. */
function lineOffsets(text) {
    const offsets = [0, 0];
    for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) offsets.push(at + 1);
    return offsets;
}

/** A part's statements cut wherever the next doesn't follow on, each run a separate image. */
function piecesOf(part) {
    const pieces = [];
    let current = null;
    for (const statement of part.statements) {
        if (!current || statement.address !== current.end) {
            current = { part, start: statement.address, end: statement.address, statements: [] };
            current.name = `${part.name} at ${hex(statement.address)}`;
            pieces.push(current);
        }
        current.statements.push(statement);
        current.end = statement.address + statement.data.length;
    }
    return pieces;
}

/** The statement a label names: the first after it at its address. */
const labelled = (part, label) => part.statements.find((s) => s.line > label.line && s.address === label.address);

/**
 * Statements without repeats: one whose bytes all repeat others' is left out unless a label names it,
 * and where a data row and code cover the same bytes the code is kept; two that disagree are a typo in
 * one of their addresses, and neither is kept.
 * @param {Set<object>} labelledStatements - the statements labels name
 */
function agreeingStatements(statements, labelledStatements) {
    const byAddress = new Map();
    const codeFirst = [...statements].sort((a, b) => Number(b.code) - Number(a.code) || a.line - b.line);
    for (const statement of codeFirst)
        statement.data.forEach((_, i) => {
            const at = statement.address + i;
            if (!byAddress.has(at)) byAddress.set(at, []);
            byAddress.get(at).push(statement);
        });
    const conflicting = new Set();
    for (const [at, here] of byAddress)
        if (new Set(here.map((s) => s.data[at - s.address])).size > 1) here.forEach((s) => conflicting.add(s));
    const repeated = new Set(
        statements.filter(
            (s) => !labelledStatements.has(s) && s.data.every((_, i) => byAddress.get(s.address + i)[0] !== s),
        ),
    );
    return {
        statements: statements.filter((s) => !conflicting.has(s) && !repeated.has(s)),
        conflicting: statements.filter((s) => conflicting.has(s)),
    };
}

const memoryOf = (statements) =>
    new Map(statements.flatMap(({ address, data }) => data.map((byte, i) => [address + i, byte])));

class Importer {
    constructor(config, text, { systemGlobals }) {
        this.config = config;
        this.text = text;
        this.lower = text.toLowerCase();
        this.offsets = lineOffsets(text);
        const read = readLevel7(text);
        this.parts = read.parts;
        this.references = read.references;
        this.doubtful = read.doubtful;
        this.systemGlobals = systemGlobals;
        this.pieces = this.parts.flatMap(piecesOf);
        this.errors = [];
        this.notes = read.doubtful.map((line) => `the disassembly's ${line}, read as data`);
        this.reasons = [];
        this.labelNames = new Set(this.parts.flatMap((part) => part.labels.map(({ name }) => name)));
        this.noteMoves = noteMoves(text);
        const used = new Set(
            config.sets.flatMap((spec) => spec.regions.map((r) => this.partNamed(r.part ?? spec.part))),
        );
        this.images = this.pieces.map((piece) => ({
            name: piece.name,
            memory: memoryOf(piece.statements),
            program: used.has(piece.part),
        }));
    }

    partNamed(name) {
        if (name === undefined) return undefined;
        const parts = this.parts.filter((part) => part.name === name || part.heading === name);
        if (parts.length !== 1) throw new Error(`${parts.length} parts of the disassembly are called ${name}`);
        return parts[0];
    }

    /** A label's address, by its name: in `part` if given, else anywhere, so long as it names one address. */
    find(name, part) {
        const addresses = new Set(
            (part ? [part] : this.parts).flatMap((p) => p.labels.filter((l) => l.name === name).map((l) => l.address)),
        );
        return addresses.size === 1 ? [...addresses][0] : undefined;
    }

    region(spec, regionSpec) {
        const named = this.partNamed(regionSpec.part ?? spec.part);
        const find = (name) => this.find(name, named);
        const start = evaluate(regionSpec.from, find);
        const end = evaluate(regionSpec.to, find);
        const where = `${spec.id}/${regionSpec.name}`;
        const parts = (named ? [named] : this.parts).filter((part) =>
            part.statements.some((s) => s.address >= start && s.address < end),
        );
        if (parts.length !== 1)
            throw new Error(
                `${where}: ${parts.length} parts have statements at ${hex(start)}-${hex(end)}; give its part`,
            );
        const [part] = parts;
        const leftOut = new Set((regionSpec.leaveOut ?? []).map((at) => evaluate(at, find)));
        const unplaced = [...leftOut].filter(
            (at) =>
                !holds({ start, end }, at) || !this.pieces.some((piece) => piece.part === part && piece.start === at),
        );
        if (unplaced.length)
            throw new Error(
                `${where}: no piece of ${part.name} in the region starts at ${unplaced.map(hex).join(", ")}, which leaveOut names`,
            );
        const { statements, conflicting } = agreeingStatements(
            this.pieces
                .filter((piece) => piece.part === part && !leftOut.has(piece.start))
                .flatMap((piece) => piece.statements)
                .filter((s) => s.address >= start && s.address < end),
            new Set(part.labels.map((label) => labelled(part, label))),
        );
        if (conflicting.length)
            this.notes.push(
                `${where}: left out statements that disagree with others at the same address, on lines ${conflicting.map((s) => s.line).join(", ")}`,
            );
        if (!statements.length)
            throw new Error(
                `${where}: every statement at ${hex(start)}-${hex(end)} disagrees with another at its address`,
            );
        const memory = new Map();
        for (const { address, data } of statements)
            data.forEach((byte, i) => {
                if (address + i < end) memory.set(address + i, byte);
            });
        const modified = statements
            .filter((s) => s.modified)
            .map(({ address, data }) => [address, address + data.length]);
        const piece = this.pieces.find((p) => p.statements.includes(statements[0]));
        return {
            name: regionSpec.name,
            fullName: where,
            imageName: piece.name,
            section: part,
            sectionInfo: {
                org: part.file ? part.file.load & 0xffff : start,
                end: Math.max(...part.statements.map((s) => s.address + s.data.length)),
                exec: part.file ? part.file.exec : null,
                statements: part.statements.filter((s) => !holds({ start, end }, s.address) || statements.includes(s)),
                labels: part.labels.filter(
                    (label) => !holds({ start, end }, label.address) || statements.includes(labelled(part, label)),
                ),
            },
            start,
            end,
            overwritten: regionSpec.overwritten === true,
            avoid: [
                ...modified,
                ...(regionSpec.avoid ?? []).map(([from, to]) => [evaluate(from, find), evaluate(to, find)]),
            ],
            osBlocks: new Set(),
            memory,
            symbols: new Map(),
            anchors: [],
            part,
        };
    }

    /**
     * Every store in the disassembly, with the config's table sizes and moves, and the moves its own notes
     * give (`... is copied to ... at &3011`).
     */
    stores(spec) {
        const find = (name) => this.find(name);
        const tables = Object.entries(spec.tableSizes ?? {}).map(([table, size]) => [
            table,
            evaluate(table, find),
            evaluate(size, find),
        ]);
        const moves = (spec.moves ?? []).map((move) => [move, evaluate(move, find)]);
        const { stores, used } = storesIn(
            this.parts.flatMap((part) => part.statements),
            {
                tableSizes: new Map(tables.map(([, address, size]) => [address, size])),
                moves: new Map([...this.noteMoves, ...moves.map(([, address]) => address)].map((a) => [a, null])),
            },
        );
        const unmatched = [...tables, ...moves].filter(([, address]) => !used.has(address)).map(([name]) => name);
        if (unmatched.length)
            throw new Error(`${spec.id}: a table or a move matches no store: ${unmatched.join(", ")}`);
        // A note's copy is often through a pointer, which no store blocks anyway.
        for (const address of this.noteMoves.filter((a) => !used.has(a)))
            this.reasons.push(`${spec.id}: the disassembly's move at ${hex(address)} matches no store`);
        return stores;
    }

    /** The labels of the set's regions: one name per address, the last before its statement, and each name once. */
    regionNames(regions, dropped) {
        const labels = regions.flatMap((region) =>
            region.sectionInfo.labels
                .filter((label) => holds(region, label.address))
                .map((label) => ({ ...label, region })),
        );
        const addressesOf = new Map();
        for (const { name, address } of labels)
            addressesOf.set(name, new Set([...(addressesOf.get(name) ?? []), address]));
        const lines = new Map();
        for (const label of labels) {
            if (addressesOf.get(label.name).size > 1) {
                dropped.push([label.name, label.address, `it names ${addressesOf.get(label.name).size} addresses`]);
                continue;
            }
            const { region } = label;
            const taken = [...region.symbols].find(([, other]) => other === label.address);
            if (taken) {
                region.symbols.delete(taken[0]);
                dropped.push([taken[0], label.address, `${region.name} calls it ${label.name}`]);
            }
            region.symbols.set(label.name, label.address);
            lines.set(label.name, label);
        }
        return lines;
    }

    /**
     * The names the set's regions' operands give addresses outside them: those no label has, no system set's
     * global has, below &8000; for an address with several, the one most instructions use. With each,
     * the first instruction that uses it, where it's linked to.
     */
    globalNames(regions, dropped) {
        const counts = new Map();
        const firstUses = new Map();
        const named = (statement) => regions.some((r) => r.part === statement.section && holds(r, statement.address));
        for (const reference of this.references) {
            const { name, address, statement } = reference;
            if (!named(statement)) continue;
            if (this.labelNames.has(name) || address >= GlobalsLimit || regions.some((r) => holds(r, address)))
                continue;
            if (!counts.has(name)) counts.set(name, new Map());
            counts.get(name).set(address, (counts.get(name).get(address) ?? 0) + 1);
            if (!firstUses.has(`${name}@${address}`)) firstUses.set(`${name}@${address}`, reference);
        }
        const candidates = new Map();
        for (const [name, byAddressCount] of counts) {
            const ranked = [...byAddressCount].sort(([, a], [, b]) => b - a);
            if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
                dropped.push([name, ranked[0][0], `it names ${ranked.length} addresses as often`]);
                continue;
            }
            const [address, uses] = ranked[0];
            if (this.systemGlobals.has(address)) {
                dropped.push([name, address, `the system sets call it ${this.systemGlobals.get(address)}`]);
                continue;
            }
            if (!candidates.has(address)) candidates.set(address, []);
            candidates.get(address).push([name, uses]);
        }
        const globals = new Map();
        const uses = new Map();
        for (const [address, names] of candidates) {
            const [[winner], ...others] = names.sort(([, a], [, b]) => b - a);
            globals.set(winner, address);
            uses.set(winner, firstUses.get(`${winner}@${address}`));
            for (const [name] of others) dropped.push([name, address, `the globals call it ${winner}`]);
        }
        return { globals, uses };
    }

    /**
     * A fragment reaching `text` on `line` (ignoring case, as a fragment does), else one reaching the
     * address that starts `statement`'s line.
     */
    fragmentOnLine(text, line, statement) {
        const at = (wanted, lineNumber) => {
            const start = this.offsets[lineNumber];
            const end = this.text.indexOf("\n", start);
            const found = this.lower.slice(start, end < 0 ? undefined : end).indexOf(wanted.toLowerCase());
            return found < 0 ? undefined : start + found;
        };
        const offset = at(text, line);
        const byName =
            offset === undefined
                ? undefined
                : textFragment(this.text, this.lower, this.text.slice(offset, offset + text.length), offset);
        if (byName) return byName;
        const address = hex(statement.address);
        const start = at(address, statement.line);
        return start === this.offsets[statement.line]
            ? textFragment(this.text, this.lower, this.text.slice(start, start + address.length), start)
            : undefined;
    }

    /**
     * Each name's place: its label's line for a region's name, and for a global's the first instruction
     * that uses it at its address; or failing that the address of the statement on that line.
     */
    places(spec, regions, globals, globalUses, labels) {
        const places = new Map();
        const unplaced = [];
        const file = new URL(this.config.source.disassembly).pathname.split("/").at(-1);
        const place = (name, found) => {
            if (found) places.set(name, `${file}#${found}`);
            else unplaced.push(name);
        };
        for (const region of regions)
            for (const name of region.symbols.keys()) {
                const label = labels.get(name);
                place(name, this.fragmentOnLine(name, label.line, labelled(region.part, label)));
            }
        for (const name of globals.keys()) {
            const { line, statement } = globalUses.get(name);
            place(name, this.fragmentOnLine(name, line, statement));
        }
        if (unplaced.length) this.notes.push(`${spec.id}: no text fragment reaches ${unplaced.sort().join(", ")}`);
        return places;
    }

    set(spec) {
        const regions = spec.regions.map((regionSpec) => this.region(spec, regionSpec));
        const dropped = [];
        const labelLines = this.regionNames(regions, dropped);
        const { globals, uses } = this.globalNames(regions, dropped);
        const stores = this.stores(spec);
        const spread = { bytesPerAnchor: this.config.bytesPerAnchor, spreadAnchors: this.config.spreadAnchors };
        for (const region of regions) {
            const { anchors, errors, notes, reasons } = chooseAnchors(region, stores, this.images, spread);
            region.anchors = anchors;
            this.errors.push(...errors);
            this.notes.push(...notes);
            this.reasons.push(...reasons);
        }
        const places = this.places(spec, regions, globals, uses, labelLines);
        return { json: this.setJson(spec, regions, globals, places), regions, dropped };
    }

    setJson(spec, regions, globals, places) {
        const { disassembly } = this.config.source;
        return {
            format: Format,
            title: spec.title,
            licence: this.config.licence,
            source: disassembly,
            notice: `The names are from ${disassembly}, whose author says: "${permissionOf(this.text)}"`,
            home: disassembly,
            nameLink: `${new URL(".", disassembly)}{place}`,
            regions: Object.fromEntries(
                regions.map((region) => [
                    region.name,
                    {
                        start: hexAddress(region.start),
                        end: hexAddress(region.end),
                        minAnchors: region.anchors.length,
                        anchors: region.anchors.map(({ at, data }) => ({
                            at: hexAddress(at),
                            bytes: Buffer.from(data).toString("hex"),
                        })),
                        symbols: byAddress(region.symbols),
                    },
                ]),
            ),
            globals: byAddress(globals),
            places: Object.fromEntries([...places].sort(([a], [b]) => (a < b ? -1 : 1))),
        };
    }
}

/**
 * A title's sets from its level7 disassembly, as its config describes them.
 * @param {{systemGlobals: Map<number, string>}} options - the addresses the system sets name, left to them
 */
export function importLevel7(config, text, options) {
    const importer = new Importer(config, text, options);
    const sets = config.sets.map((spec) => ({
        id: spec.id,
        file: `${config.id}-${spec.id}.json`,
        ...importer.set(spec),
    }));
    return { sets, errors: importer.errors, notes: importer.notes, reasons: importer.reasons };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The text of a config's disassembly, fetched from `source.disassembly` or read from `file`, refused
 * unless its SHA-256 is `source.sha256`.
 */
export async function level7Text(config, file) {
    const { disassembly, sha256: want } = config.source;
    let bytes;
    if (file !== undefined) bytes = readFileSync(file);
    else {
        const response = await fetch(disassembly);
        if (!response.ok) throw new Error(`Fetching ${disassembly} failed with ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
    }
    const got = sha256(bytes);
    if (got !== want) throw new Error(`${file ?? disassembly} has SHA-256 ${got}, and the config pins ${want}`);
    return bytes.toString("latin1");
}

/** The title's sets as the importer makes them, for the checks (title-build.js). */
export async function importLevel7Title(configPath, options) {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return importLevel7(config, await level7Text(config, options.source), { systemGlobals: systemGlobals() });
}

async function main() {
    const { values } = parseArgs({
        options: {
            config: { type: "string" },
            ...Level7Options,
            out: { type: "string", default: SetsDir },
            verbose: { type: "boolean", short: "v", default: false },
        },
    });
    if (!values.config) throw new Error(`Usage: import-level7.js --config <file> ${Level7Usage}`);
    const config = JSON.parse(readFileSync(values.config, "utf8"));
    if (config.importer !== Level7) throw new Error(`${values.config} isn't a config for the ${Level7} importer`);
    const text = await level7Text(config, values.source);
    console.log(`Read ${config.source.disassembly}`);
    return writeTitle(config, importLevel7(config, text, { systemGlobals: systemGlobals() }), values);
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
