#!/usr/bin/env node
/**
 * Makes ROMs' symbol sets from acornaeology's disassemblies' JSON (dasmos's schema 4): for each version a
 * curator's config under symbols/configs/ lists, the labels of its items, in regions anchored on the ROM,
 * and its labels outside the ROM in the config's `globals` ranges. docs/symbol-importers.md says how the
 * names are chosen.
 *
 * Usage: node tools/symbols/import-acornaeology.js --config symbols/configs/nfs.json [--verbose]
 *            && node tools/symbols/build-index.js
 *
 * Fetches each version's JSON and the licence at the config's commit, each version's page on acornaeology's
 * site, whose anchors the names link to, and any ROM the config gives by URL (a version's, or one of the
 * `otherRoms` the anchors must also tell apart). Writes nothing if a JSON's bytes aren't its ROM's, if a
 * region can't be anchored, if its anchors all match another ROM (jsbeeb's, another version's, or one of
 * `otherRoms`), if a page has no anchor for a name in the ROM, if a set fails the index's checks, or if any
 * of those ROMs matches two regions over the same addresses.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Format, parseAddress, parseSet } from "jsbeeb/src/symbol-sets.js";
import { chooseAnchors, ownedIfStored } from "./anchor-chooser.js";
import { checkSet, formatJson, readMosSets, SymbolsDir, systemGlobals } from "./build-index.js";
import { SameCode } from "./corpus-check.js";
import { matchingRegions, overlappingRegions } from "./check-memory.js";
import { fetchRom, otherRomsThan, romBanks, romImages, romKey, romOf } from "./rom-images.js";

const Importer = "acornaeology";
const SchemaVersion = 4;
const AddressLimit = 0x10000;
const AddressAnchor = /\bid="(addr-([0-9A-Fa-f]{4}))"/g;
const SidewaysSize = 0x4000;

const hexAddress = (address) => `0x${address.toString(16).padStart(4, "0")}`;
const hex = (address) => `&${address.toString(16).toUpperCase().padStart(4, "0")}`;
const within = (ranges, address) => ranges.some(({ start, end }) => address >= start && address < end);

const parseRange = ({ start, end }, what) => ({
    start: parseAddress(start, `${what}'s start`),
    end: parseAddress(end, `${what}'s end`, AddressLimit),
});

/** What messages call a set's ROM: jsbeeb's file, or the last part of the URL it's fetched from. */
export const romName = (rom) => (typeof rom === "string" ? rom : path.posix.basename(new URL(rom.url).pathname));

/**
 * What the importer reads from a disassembly's JSON: where the ROM runs, its statements where they are in
 * the ROM, the labels of the code that runs there (an item's own and those inside it, each with the item's
 * address), the labels of code the ROM moves elsewhere to run, and the names it gives addresses outside the
 * ROM, each with whether its memory map describes it.
 * @returns {{base: number, end: number, statements: {address: number, data: number[], code: boolean}[],
 *     labels: {address: number, name: string, item: number}[], moved: {address: number, name: string}[],
 *     outside: {address: number, name: string, mapped: boolean}[]}}
 */
export function readDisassembly(json) {
    if (json?.meta?.schema_version !== SchemaVersion)
        throw new Error(`The disassembly has schema version ${json?.meta?.schema_version}, not ${SchemaVersion}`);
    const statements = json.items.map((item) => ({
        address: item.binary_addr ?? item.addr,
        data: item.bytes,
        code: item.type === "code",
    }));
    const labels = [];
    const moved = [];
    for (const item of json.items) {
        const inside = Object.entries(item.sub_labels ?? {}).flatMap(([at, names]) =>
            names.map((name) => ({ address: Number(at), name })),
        );
        const own = [...(item.labels ?? []).map((name) => ({ address: item.addr, name })), ...inside];
        if ((item.binary_addr ?? item.addr) !== item.addr) moved.push(...own);
        else labels.push(...own.map((label) => ({ ...label, item: item.addr })));
    }
    const mapped = new Set(json.memory_map.map(({ name }) => name));
    const outside = Object.entries(json.external_labels).map(([name, address]) => ({
        address,
        name,
        mapped: mapped.has(name),
    }));
    return { base: json.meta.load_addr, end: json.meta.end_addr, statements, labels, moved, outside };
}

/**
 * The anchors a disassembly's page has for addresses, `id="addr-800E"`, each id by its address.
 * @returns {Map<number, string>}
 */
export function pageAnchors(html) {
    return new Map([...html.matchAll(AddressAnchor)].map(([, id, digits]) => [parseInt(digits, 16), id]));
}

/** One name per address outside the ROM: the one the memory map describes, else the only one. */
function globalsOf(outside, ranges, systemGlobals, stored, dropped, errors) {
    const named = new Map();
    for (const label of outside) {
        if (!within(ranges, label.address)) continue;
        if (systemGlobals.has(label.address) && !stored.has(label.address)) {
            dropped.push([label.name, label.address, `the system sets call it ${systemGlobals.get(label.address)}`]);
            continue;
        }
        if (!named.has(label.address)) named.set(label.address, []);
        named.get(label.address).push(label);
    }
    const globals = new Map();
    for (const [address, labels] of named) {
        const mapped = labels.filter((label) => label.mapped);
        const chosen = labels.length === 1 ? labels[0] : mapped.length === 1 ? mapped[0] : undefined;
        if (!chosen) {
            errors.push(`${hex(address)} has names ${labels.map(({ name }) => name).join(", ")} and none to prefer`);
            continue;
        }
        globals.set(chosen.name, address);
        for (const { name } of labels)
            if (name !== chosen.name) dropped.push([name, address, `the memory map calls it ${chosen.name}`]);
    }
    return globals;
}

/** A region's names, by name: the first label the disassembly gives each address in it. */
function regionSymbols(labels, start, end, dropped) {
    const named = new Map();
    for (const { address, name } of labels) {
        if (address < start || address >= end) continue;
        if (named.has(address)) dropped.push([name, address, `it's also ${named.get(address)}`]);
        else named.set(address, name);
    }
    return new Map([...named].map(([address, name]) => [name, address]));
}

/** The addresses as [from, to) ranges. */
export function rangesOf(addresses) {
    const out = [];
    for (const address of [...addresses].sort((a, b) => a - b)) {
        if (out.length && out.at(-1)[1] === address) out.at(-1)[1] = address + 1;
        else out.push([address, address + 1]);
    }
    return out;
}

/**
 * Where the images a region's `sameCodeIn` names differ from it, each address with the first image that
 * differs there, for its anchors to avoid so that it matches them too. An image that isn't there, or isn't
 * the same code, is an error.
 */
export function sameCodeDifferences(region, sameCode, images, errors) {
    const differing = new Map();
    for (const name of sameCode) {
        const image = images.find((candidate) => candidate.name === name);
        if (!image) {
            errors.push(`${region.fullName}: there's no ${name} to share its code with`);
            continue;
        }
        const different = [...region.memory].filter(([address, byte]) => image.memory.get(address) !== byte);
        if (different.length > region.memory.size * (1 - SameCode))
            errors.push(`${region.fullName}: ${name} differs in ${different.length} bytes, so isn't the same code`);
        for (const [address] of different) if (!differing.has(address)) differing.set(address, name);
    }
    return differing;
}

/**
 * Leaves out a region's names on statements another ROM it shares its code with changes, where the name
 * might not mean what it says, and notes each.
 */
export function leaveOutChanged(region, differing, statementAt, itemOf, dropped, notes) {
    for (const [name, address] of [...region.symbols]) {
        const statement = statementAt.get(itemOf.get(name));
        const changed = statement && statement.data.map((_, i) => differing.get(statement.address + i)).find(Boolean);
        if (!changed) continue;
        region.symbols.delete(name);
        const why = `${changed} changes its statement`;
        dropped.push([name, address, why]);
        notes.push(`${region.fullName}: left out ${name} at ${hex(address)}, since ${why}`);
    }
}

const byAddress = (names) =>
    Object.fromEntries([...names].sort(([, a], [, b]) => a - b).map(([name, address]) => [name, hexAddress(address)]));

/** Every bank the ROM's size of the other ROMs, and each shorter one from its start, placed where the ROM runs. */
function otherImages(otherRoms, base, size) {
    const shorter = otherRoms.filter(({ bytes }) => bytes.length < size);
    const banked = otherRoms.filter(({ bytes }) => bytes.length >= size && bytes.length % size === 0);
    return [
        ...romImages(banked, base, size),
        ...shorter.map(({ name, bytes }) => ({
            name,
            memory: new Map(Array.from(bytes, (byte, i) => [base + i, byte])),
            program: false,
        })),
    ];
}

/**
 * One ROM's set from its disassembly, as the config's entry for it describes it.
 * @param {object} set - the config's entry for the version, from versionsOf
 * @param {ReturnType<typeof readDisassembly>} disassembly
 * @param {object} options
 * @param {Uint8Array} options.rom - the ROM the set is anchored on
 * @param {{name: string, bytes: Uint8Array}[]} options.otherRoms - ROMs whose banks the anchors must tell
 *     apart, and shorter ROMs whose start they must
 * @param {Map<number, string>} options.systemGlobals - addresses the system sets name, which the set leaves to them
 * @param {string} options.notice
 * @param {Map<number, string>} [options.anchors] - the ids the set's `home` page has for addresses
 *     (pageAnchors), to link each name with one to it
 * @returns {{json: object, errors: string[], notes: string[], dropped: [string, number, string][]}}
 */
export function importAcornaeology(set, disassembly, { rom, otherRoms, systemGlobals, notice, anchors = null }) {
    const { base, end, statements, labels, moved, outside } = disassembly;
    const name = romName(set.rom);
    const errors = [];
    const notes = [];
    const dropped = [];
    if (rom.length !== end - base)
        return {
            json: null,
            errors: [`${name} is ${rom.length} bytes, the disassembly ${end - base}`],
            notes,
            dropped,
        };
    for (const { address, data } of statements)
        if (data.some((byte, i) => rom[address - base + i] !== byte))
            errors.push(`The disassembly's bytes at ${hex(address)} aren't ${name}'s`);
    if (errors.length) return { json: null, errors, notes, dropped };

    const section = {};
    const sectionInfo = { org: base, end, exec: null, statements, labels };
    const memory = new Map(Array.from(rom, (byte, i) => [base + i, byte]));
    const images = otherImages(otherRoms, base, rom.length);
    const spread = { bytesPerAnchor: set.bytesPerAnchor, spreadAnchors: set.spreadAnchors };
    const statementAt = new Map(statements.map((statement) => [statement.address, statement]));
    const itemOf = new Map(labels.map((label) => [label.name, label.item]));
    const regions = set.regions.map((spec) => {
        const { start, end: regionEnd } = parseRange(spec, `region ${spec.name}`);
        const region = {
            name: spec.name,
            fullName: `${set.id}/${spec.name}`,
            imageName: name,
            section,
            sectionInfo,
            start,
            end: regionEnd,
            overwritten: false,
            avoid: [],
            osBlocks: new Set(),
            memory: new Map([...memory].filter(([address]) => address >= start && address < regionEnd)),
        };
        const sameCode = spec.sameCodeIn ?? [];
        const differing = sameCodeDifferences(region, sameCode, images, errors);
        region.avoid = rangesOf(differing.keys());
        const told = images.filter((image) => !sameCode.includes(image.name));
        const chosen = chooseAnchors(region, [], told, spread);
        errors.push(...chosen.errors);
        notes.push(...chosen.notes);
        const named = { ...region, anchors: chosen.anchors, symbols: regionSymbols(labels, start, regionEnd, dropped) };
        leaveOutChanged(named, differing, statementAt, itemOf, dropped, notes);
        return named;
    });
    for (const { address, name: label } of labels)
        if (!within(regions, address)) dropped.push([label, address, "no region holds it"]);
    for (const { address, name: label } of moved) dropped.push([label, address, "it's in code the ROM moves"]);
    const globalRanges = set.globals.map((range, i) => parseRange(range, `globals range ${i}`));
    const stored = ownedIfStored(statements.filter(({ address }) => within(regions, address)));
    const globals = globalsOf(outside, globalRanges, systemGlobals, stored, dropped, errors);
    for (const { address, name: label } of outside)
        if (!within(globalRanges, address)) dropped.push([label, address, "it's outside the globals' ranges"]);

    const page = anchors && new URL(set.home);
    const pageName = page && path.posix.basename(page.pathname);
    const places = new Map();
    if (anchors) {
        for (const [label, address] of [...globals, ...regions.flatMap((region) => [...region.symbols])]) {
            const id = anchors.get(address) ?? anchors.get(itemOf.get(label));
            if (id) places.set(label, `${pageName}#${id}`);
        }
        const unanchored = regions
            .flatMap((region) => [...region.symbols.keys()])
            .filter((label) => !places.has(label));
        if (unanchored.length) errors.push(`${set.home} has no anchor for ${unanchored.sort().join(", ")}`);
    }
    const { repository, commit } = set.source;
    const json = {
        format: Format,
        title: set.title,
        licence: set.licence,
        source: `${repository}/blob/${commit}/${set.disassembly}`,
        notice,
        madeFrom: [romKey(rom)],
        ...(set.home !== undefined && { home: set.home }),
        ...(anchors && { nameLink: `${new URL(".", page)}{place}` }),
        globals: byAddress(globals),
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
        ...(anchors && { places: Object.fromEntries([...places].sort(([a], [b]) => (a < b ? -1 : 1))) }),
    };
    return { json, errors, notes, dropped };
}

/** The config's versions, each with the fields the config shares among them filled in. */
export const versionsOf = (config) =>
    config.sets.map((set) => ({
        licence: config.licence,
        source: config.source,
        globals: config.globals,
        bytesPerAnchor: config.bytesPerAnchor,
        spreadAnchors: config.spreadAnchors,
        ...set,
    }));

/**
 * What of the sets each ROM matches while it's paged in at `base`, as "set/region", and which pairs of
 * those overlap, so that the debugger would show neither.
 * @param {Record<string, object>} sets - parsed sets by id
 * @param {{name: string, bytes: Uint8Array}[]} roms
 * @returns {{name: string, found: string[], overlaps: string[]}[]}
 */
export function romMatches(sets, roms, base) {
    return roms.map(({ name, bytes }) => {
        const found = matchingRegions(sets, (address) => bytes[address - base]);
        return { name, found, overlaps: overlappingRegions(sets, found) };
    });
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetching ${url} failed with ${response.status}`);
    return response.text();
}

async function main() {
    const { values } = parseArgs({
        options: { config: { type: "string" }, verbose: { type: "boolean", short: "v", default: false } },
    });
    if (!values.config) throw new Error("Usage: import-acornaeology.js --config <file> [--verbose]");
    const config = JSON.parse(readFileSync(values.config, "utf8"));
    if (config.importer !== Importer) throw new Error(`${values.config} isn't a config for the ${Importer} importer`);
    const { repository, commit, licenceFile } = config.source;
    const raw = `${repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${commit}`;
    const versions = versionsOf(config);
    const licence = await fetchText(`${raw}/${licenceFile}`);
    const notice = `The names are acornaeology's, under this licence:\n\n${licence.trim()}`;
    const roms = await Promise.all(versions.map(({ rom }) => romOf(rom)));
    const otherCopies = await Promise.all(
        (config.otherRoms ?? []).map(async (rom) => ({ name: romName(rom), bytes: await fetchRom(rom) })),
    );
    const systemNames = systemGlobals();
    const mosSets = readMosSets();
    const made = [];
    for (const [i, set] of versions.entries()) {
        const [disassemblyText, page] = await Promise.all([
            fetchText(`${raw}/${set.disassembly}`),
            set.home === undefined ? null : fetchText(set.home),
        ]);
        const jsbeebRoms = otherRomsThan(typeof set.rom === "string" ? set.rom : null, roms[i].length);
        const otherVersions = versions
            .map((other, k) => ({ name: romName(other.rom), bytes: roms[k] }))
            .filter(({ name }, k) => k !== i && !jsbeebRoms.some((jsbeebRom) => jsbeebRom.name === name));
        const disassembly = readDisassembly(JSON.parse(disassemblyText));
        const { json, errors, notes, dropped } = importAcornaeology(set, disassembly, {
            rom: roms[i],
            otherRoms: [...jsbeebRoms, ...otherVersions, ...otherCopies],
            systemGlobals: systemNames,
            notice,
            anchors: page === null ? null : pageAnchors(page),
        });
        const setFile = `sets/${set.id}.json`;
        const problems = [...errors, ...(json ? checkSet(json, { file: setFile, mosSets }) : [])];
        console.log(`-- ${set.id}`);
        if (values.verbose)
            for (const [label, address, why] of dropped) console.log(`    left out ${label} ${hex(address)}: ${why}`);
        for (const note of notes) console.log(`note: ${note}`);
        for (const problem of problems) console.error(`error: ${problem}`);
        made.push({ setFile, json, dropped, problems, base: disassembly.base });
    }
    if (made.some(({ problems }) => problems.length)) {
        console.error("Nothing written");
        return 1;
    }
    const sets = Object.fromEntries(made.map(({ setFile, json }) => [path.basename(setFile, ".json"), parseSet(json)]));
    const base = made[0].base;
    if (made.some((version) => version.base !== base))
        throw new Error("The versions' ROMs don't all run at one address");
    const everyRom = [
        ...versions.map((set, i) => ({ name: romName(set.rom), bytes: roms[i] })),
        ...otherCopies,
        ...romBanks(
            otherRomsThan(null, 1).filter(({ name }) => !versions.some((set) => set.rom === name)),
            SidewaysSize,
        ),
    ];
    const matches = romMatches(sets, everyRom, base);
    for (const { name, found, overlaps } of matches) {
        if (found.length) console.log(`${name} matches ${found.join(", ")}`);
        for (const pair of overlaps) console.error(`error: ${name} matches ${pair}, which overlap`);
    }
    if (matches.some(({ overlaps }) => overlaps.length)) {
        console.error("Nothing written");
        return 1;
    }
    for (const { setFile, json, dropped } of made) {
        const target = path.join(SymbolsDir, setFile);
        writeFileSync(target, await formatJson(json, target));
        const summary = Object.entries(json.regions).map(
            ([name, region]) => `${name} ${region.anchors.length}/${Object.keys(region.symbols).length}`,
        );
        console.log(
            `Wrote ${setFile}: ${summary.join(", ")}; ${Object.keys(json.globals).length} globals (${dropped.length} names left out)`,
        );
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
