#!/usr/bin/env node
/**
 * Makes ROMs' symbol sets from ACME sources (acme-build.js): for each version a curator's config under
 * symbols/configs/ lists, the labels the source assembles into the ROM, in regions anchored on it, and the
 * `=` names its instructions use as memory operands in the config's `globals` and `workspace` ranges.
 * docs/symbol-importers.md
 * says how the names are chosen.
 *
 * Usage: node tools/symbols/import-acme.js --config symbols/configs/bbc-b-mos.json [--source <checkout>]
 *            [--acme <path>] [--out symbols/sets] [--verbose] && node tools/symbols/build-index.js
 *
 * Fetches the config's commit of its repository, or takes `--source`, a clean checkout of it, and assembles
 * each version's source with `--acme`, else $ACME, else `acme` on the PATH. Writes <config id>-<set id>.json
 * for each set. Writes nothing if a version doesn't assemble to its ROM's bytes in its regions, if a region
 * can't be anchored, if its anchors all match another ROM (jsbeeb's, another version's, or one of
 * `otherRoms`), if a name is defined in more than one place, if a set fails the index's checks, or if any of
 * those ROMs matches two regions over the same addresses.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseAddress, parseSet } from "jsbeeb/src/symbol-sets.js";
import { AcmeOptions, AcmeUsage, instructionOf, withAcmeBuild } from "./acme-build.js";
import { chooseAnchors, ownedIfStored } from "./anchor-chooser.js";
import { SymbolsDir, systemGlobals } from "./build-index.js";
import { leaveOutChanged, rangesOf, romMatches, romName, sameCodeDifferences } from "./import-acornaeology.js";
import { evaluate, onePlaceEach, setJson, writeTitle } from "./import-baron.js";
import { fetchRom, otherRomsThan, romBanks, romImages, romKey, romOf } from "./rom-images.js";

const Importer = "acme";
const AddressLimit = 0x10000;
const LocalPrefix = /^[.@]/;
const ParagraphAnchor = /\bid="(SP\d+)"/g;
const PageDefinition =
    /\n(?:<span class="ACME-plain-syntax">\s*<\/span>)?<span class="ACME-plain-syntax">\.<\/span><span class="ACME-\w+-syntax">(\w+)<\/span>/g;
const HtmlExtension = ".html";

const hex = (address) => `&${address.toString(16).toUpperCase().padStart(4, "0")}`;
const holds = (range, address) => address >= range.start && address < range.end;
const nameOf = (sourceName) => sourceName.replace(LocalPrefix, "");

/** The config as setJson takes it for one version: its ROM, its own home, and its source as the file it links. */
const setConfig = (config, spec, rom) => ({
    ...config,
    home: spec.home ?? config.home,
    madeFrom: [romKey(rom)],
    source: { ...config.source, link: spec.assemble },
});

/**
 * How often the instructions of a build use each `=` name as the base of a memory operand, by the name as
 * the source writes it.
 */
function operandUses(statements) {
    const uses = new Map();
    for (const { text } of statements) {
        const { base } = instructionOf(text ?? "");
        if (base) uses.set(base, (uses.get(base) ?? 0) + 1);
    }
    return uses;
}

/**
 * Where an annotated listing's HTML pages define each name: the page and the id of the last paragraph
 * anchor (`id="SP21"`) before the line that starts with it, as `.name` in ACME's syntax colouring.
 * @param {{file: string, html: string}[]} pages
 * @returns {Map<string, string[]>}
 */
export function pageDefinitions(pages) {
    const out = new Map();
    for (const { file, html } of pages) {
        const anchors = [...html.matchAll(ParagraphAnchor)].map((match) => [match.index, match[1]]);
        for (const match of html.matchAll(PageDefinition)) {
            const anchor = anchors.findLast(([at]) => at < match.index);
            if (!anchor) continue;
            if (!out.has(match[1])) out.set(match[1], []);
            out.get(match[1]).push(`${file}#${anchor[1]}`);
        }
    }
    return out;
}

/**
 * One version's set from its build.
 * @param {object} config - the curator's config
 * @param {object} spec - the config's entry for the version
 * @param {{base: number, binary: Uint8Array, statements: object[], definitions: object[]}} build - from acme-build.js
 * @param {object} options
 * @param {Uint8Array} options.rom - the ROM the version is anchored on
 * @param {{name: string, bytes: Uint8Array}[]} options.otherRoms - ROMs whose banks the anchors must tell apart
 * @param {Map<number, string>} options.systemGlobals - addresses the system sets name, which a set that isn't
 *     one leaves to them
 * @param {Map<string, string[]> | null} [options.pages] - where the set's `pages` define each name
 *     (pageDefinitions), to link to instead of the source's lines
 * @returns {{id: string, file: string, json: object, regions: object[], dropped: [string, number, string][],
 *     errors: string[], notes: string[], reasons: string[]}}
 */
export function importAcmeSet(config, spec, build, { rom, otherRoms, systemGlobals, pages = null }) {
    const errors = [];
    const notes = [];
    const reasons = [];
    const dropped = [];
    const { base, binary, statements, definitions } = build;
    const romEnd = base + rom.length;
    const values = new Map(definitions.map(({ name, value }) => [nameOf(name), value]));
    const find = (name) => values.get(name);
    const memory = new Map(Array.from(rom, (byte, i) => [base + i, byte]));
    const labels = definitions
        .filter(({ label, value }) => label && value >= base && value < romEnd)
        .map(({ name, value }) => ({ address: value, name: nameOf(name) }));
    const chooserStatements = statements.map(({ address, data, text }) => ({
        address,
        data,
        code: instructionOf(text ?? "").code,
        skip: false,
        section: null,
    }));
    const section = {};
    for (const statement of chooserStatements) statement.section = section;
    const sectionInfo = { org: base, end: romEnd, exec: null, statements: chooserStatements, labels };
    const images = romImages(otherRoms, base, rom.length);

    const regions = spec.regions.map((regionSpec) => {
        const fullName = `${spec.id}/${regionSpec.name}`;
        const start = evaluate(regionSpec.from, find);
        const end = evaluate(regionSpec.to, find);
        if (start < base || end <= start || end > romEnd)
            throw new Error(`${fullName}: ${hex(start)}-${hex(end)} isn't inside the ROM, ${hex(base)}-${hex(romEnd)}`);
        const differs = Array.from({ length: end - start }, (_, i) => start + i).filter(
            (address) => binary[address - base] !== memory.get(address),
        );
        if (differs.length)
            errors.push(
                `${fullName}: ${spec.assemble} assembles to bytes that aren't ${romName(spec.rom)}'s at ${hex(differs[0])}`,
            );
        const region = {
            name: regionSpec.name,
            fullName,
            imageName: romName(spec.rom),
            section,
            sectionInfo,
            start,
            end,
            overwritten: false,
            avoid: [],
            osBlocks: new Set(),
            memory: new Map([...memory].filter(([address]) => address >= start && address < end)),
            symbols: new Map(),
            anchors: [],
            sameCode: regionSpec.sameCodeIn ?? [],
        };
        region.differing = sameCodeDifferences(region, region.sameCode, images, errors);
        region.avoid = rangesOf(region.differing.keys());
        return region;
    });

    const leftOut = (config.leaveOut ?? []).map((pattern) => new RegExp(pattern));
    const kept = definitions.filter(({ name, value }) => {
        if (!leftOut.some((pattern) => pattern.test(nameOf(name)))) return true;
        dropped.push([nameOf(name), value, "the config leaves it out"]);
        return false;
    });
    // The label written last, nearest the bytes, names its address.
    for (const { name, value, label } of [...kept].reverse()) {
        if (!label) continue;
        const region = regions.find((r) => holds(r, value));
        if (!region) {
            dropped.push([nameOf(name), value, "no region holds it"]);
            continue;
        }
        const taken = [...region.symbols].find(([, address]) => address === value);
        if (taken) dropped.push([nameOf(name), value, `${region.name} calls it ${taken[0]}`]);
        else region.symbols.set(nameOf(name), value);
    }

    const statementAt = new Map(statements.map((statement) => [statement.address, statement]));
    const labelAt = new Map(labels.map(({ address, name }) => [name, address]));
    for (const region of regions) leaveOutChanged(region, region.differing, statementAt, labelAt, dropped, notes);

    const rangesNamed = (key) =>
        (spec[key] ?? config[key] ?? []).map(({ start, end }, i) => ({
            start: parseAddress(start, `${key} range ${i}'s start`),
            end: parseAddress(end, `${key} range ${i}'s end`, AddressLimit),
        }));
    const globalRanges = rangesNamed("globals");
    const workspaceRanges = rangesNamed("workspace");
    for (const global of globalRanges)
        for (const workspace of workspaceRanges)
            if (global.start < workspace.end && workspace.start < global.end)
                errors.push(
                    `the globals range at ${hex(global.start)} overlaps the workspace range at ${hex(workspace.start)}`,
                );
    const uses = operandUses(statements);
    const stored = ownedIfStored(chooserStatements.filter((s) => regions.some((r) => holds(r, s.address))));
    const candidates = new Map();
    for (const definition of kept) {
        const { name, value, label } = definition;
        if (label) continue;
        if (!uses.has(name)) {
            dropped.push([nameOf(name), value, "no instruction uses it as a memory operand"]);
            continue;
        }
        if (![...globalRanges, ...workspaceRanges].some((range) => holds(range, value))) {
            dropped.push([nameOf(name), value, "it's outside the globals' and the workspace's ranges"]);
            continue;
        }
        if (!config.system && systemGlobals.has(value) && !stored.has(value)) {
            dropped.push([nameOf(name), value, `the system sets call it ${systemGlobals.get(value)}`]);
            continue;
        }
        if (!candidates.has(value)) candidates.set(value, []);
        candidates.get(value).push(definition);
    }
    const globals = new Map();
    const workspace = new Map();
    for (const [address, named] of candidates) {
        const [chosen, ...others] = [...named].sort((a, b) => uses.get(b.name) - uses.get(a.name) || a.line - b.line);
        const inWorkspace = workspaceRanges.some((range) => holds(range, address));
        (inWorkspace ? workspace : globals).set(nameOf(chosen.name), address);
        for (const { name } of others)
            dropped.push([
                nameOf(name),
                address,
                `the ${inWorkspace ? "workspace" : "globals"} call it ${nameOf(chosen.name)}`,
            ]);
    }

    const spread = { bytesPerAnchor: config.bytesPerAnchor, spreadAnchors: config.spreadAnchors };
    for (const region of regions) {
        const told = images.filter((image) => !region.sameCode.includes(image.name));
        const chosen = chooseAnchors(region, [], told, spread);
        region.anchors = chosen.anchors;
        errors.push(...chosen.errors);
        notes.push(...chosen.notes);
        reasons.push(...chosen.reasons);
    }

    const definedAt = pages ?? new Map();
    if (!pages)
        for (const { name, line } of definitions) {
            if (!definedAt.has(nameOf(name))) definedAt.set(nameOf(name), []);
            definedAt.get(nameOf(name)).push(`${spec.assemble}#L${line}`);
        }
    const every = [...regions.flatMap((region) => [...region.symbols.keys()]), ...globals.keys(), ...workspace.keys()];
    const places = onePlaceEach(spec.id, every, definedAt, errors);
    const json = setJson(setConfig(config, spec, rom), spec, regions, globals, places, {
        nameLink: pages ? `${spec.pages.url}{place}` : undefined,
        system: config.system === true,
        workspace,
    });
    return {
        id: spec.id,
        file: `${config.id}-${spec.id}.json`,
        json,
        regions,
        dropped,
        errors,
        notes,
        reasons,
    };
}

/**
 * The config's sets from their builds, each version's anchors telling it apart from every bank its size of
 * `otherRoms` and from the other versions' ROMs.
 * @param {Map<string, object>} builds - each source's build, by its path
 * @param {Uint8Array[]} roms - each version's ROM, in the config's order
 * @param {{name: string, bytes: Uint8Array}[]} otherRoms
 * @param {{system?: Map<number, string>, pages?: Map<string, Map<string, string[]>>}} [options] - the
 *     system sets' globals, and each set's pageDefinitions by its id
 */
export function importAcme(config, builds, roms, otherRoms, { system = new Map(), pages = new Map() } = {}) {
    const sets = config.sets.map((spec, i) => {
        const otherVersions = config.sets
            .map((other, k) => ({ name: romName(other.rom), bytes: roms[k] }))
            .filter(({ name }, k) => k !== i && !otherRoms.some((rom) => rom.name === name));
        const others = [...otherRoms, ...otherVersions].filter(
            ({ name, bytes }) => name !== romName(spec.rom) && bytes.length % roms[i].length === 0,
        );
        return importAcmeSet(config, spec, builds.get(spec.assemble), {
            rom: roms[i],
            otherRoms: others,
            systemGlobals: system,
            pages: pages.get(spec.id) ?? null,
        });
    });
    return {
        sets,
        errors: sets.flatMap(({ errors }) => errors),
        notes: sets.flatMap(({ notes }) => notes),
        reasons: sets.flatMap(({ reasons }) => reasons),
    };
}

const readPages = (dir) =>
    readdirSync(dir)
        .filter((file) => file.endsWith(HtmlExtension))
        .sort()
        .map((file) => ({ file, html: readFileSync(path.join(dir, file), "utf8") }));

async function main() {
    const { values } = parseArgs({
        options: {
            config: { type: "string" },
            ...AcmeOptions,
            out: { type: "string", default: path.join(SymbolsDir, "sets") },
            verbose: { type: "boolean", short: "v", default: false },
        },
    });
    if (!values.config) throw new Error(`Usage: import-acme.js --config <file> ${AcmeUsage}`);
    const config = JSON.parse(readFileSync(values.config, "utf8"));
    if (config.importer !== Importer) throw new Error(`${values.config} isn't a config for the ${Importer} importer`);
    const roms = await Promise.all(config.sets.map(({ rom }) => romOf(rom)));
    const copies = await Promise.all(
        (config.otherRoms ?? []).map(async (rom) => ({ name: romName(rom), bytes: await fetchRom(rom) })),
    );
    const jsbeebRoms = otherRomsThan(null, 1);
    return withAcmeBuild(config, values, async ({ sourceDir, builds, acme }) => {
        console.log(`Assembled ${builds.size} sources with ${acme}`);
        const pages = new Map(
            config.sets
                .filter((spec) => spec.pages !== undefined)
                .map((spec) => [spec.id, pageDefinitions(readPages(path.join(sourceDir, spec.pages.directory)))]),
        );
        const imported = importAcme(config, builds, roms, [...jsbeebRoms, ...copies], {
            system: config.system ? new Map() : systemGlobals(),
            pages,
        });
        const bases = new Set(config.sets.map((spec) => builds.get(spec.assemble).base));
        if (bases.size !== 1) throw new Error("The versions' ROMs don't all run at one address");
        const [base] = bases;
        if (!imported.errors.length) {
            const sets = Object.fromEntries(imported.sets.map(({ file, json }) => [file, parseSet(json)]));
            const size = Math.max(...roms.map((rom) => rom.length));
            const versions = config.sets.map((spec, i) => ({ name: romName(spec.rom), bytes: roms[i] }));
            const everyRom = [
                ...versions,
                ...copies,
                ...romBanks(
                    jsbeebRoms.filter(({ name }) => !versions.some((version) => version.name === name)),
                    size,
                ),
            ];
            for (const { name, found, overlaps } of romMatches(sets, everyRom, base)) {
                if (found.length) console.log(`${name} matches ${found.join(", ")}`);
                imported.errors.push(...overlaps.map((pair) => `${name} matches ${pair}, which overlap`));
            }
        }
        return writeTitle(config, imported, values);
    });
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
