#!/usr/bin/env node
/**
 * Checks every symbol set under symbols/sets/ as the registry's build will, and writes
 * symbols/index.json from them: each set's location, licence and regions, without the
 * regions' symbols and scopes. The format is "Symbol sets" in docs/media-registry-proposal.md.
 * Also writes symbols/titles.md, the list of titles (titles.js).
 *
 * Usage: node tools/symbols/build-index.js
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format as prettier, resolveConfig } from "prettier";

import { readConfigs, titleRows, titlesMarkdown, TitlesFile } from "./titles.js";
import { Format, isHttps, nameLinkProblems, parseAddress, parseSet, RelativeJsonPath } from "jsbeeb/src/symbol-sets.js";

export const SymbolsDir = fileURLToPath(new URL("../../symbols/", import.meta.url));
const SetsDir = "sets";
const IndexFile = "index.json";
const MosSetsFile = "mos-sets.json";

export const MinAnchorBytes = 4;
export const MaxAnchorBytes = 8;
const IoStart = 0xfc00;
const IoEnd = 0xff00;
const ImageKey = /^[0-9a-f]{32}$/;
const GplFamily = /GPL/i;

const hex = (address) => `&${address.toString(16).toUpperCase().padStart(4, "0")}`;
const isText = (value) => typeof value === "string" && value.length > 0;
const PlacePath = /^[\w.~-]+(?:\/[\w.~-]+)*$/;
const PlaceFragment = /^[\w.~:=%,&-]*$/;

/** A path from the template's base, and optionally a fragment, that can't climb out of it. */
export function isPlace(text) {
    const [pathPart, ...fragments] = text.split("#");
    return (
        fragments.length <= 1 &&
        PlacePath.test(pathPart) &&
        !pathPart.split("/").some((segment) => segment === "." || segment === "..") &&
        PlaceFragment.test(fragments[0] ?? "")
    );
}

function checkLinks(json, set, problems) {
    if (json.home !== undefined && !isHttps(json.home)) problems.push(`its home, ${json.home}, isn't https`);
    if (json.nameLink !== undefined) problems.push(...nameLinkProblems(json.nameLink));
    const wantsPlaces = typeof json.nameLink === "string" && json.nameLink.includes("{place}");
    if (json.places === undefined) {
        if (wantsPlaces) problems.push("its nameLink has {place}, but it has no places");
        return;
    }
    if (!wantsPlaces) problems.push("it has places, but no nameLink with {place}");
    const names = new Set([
        ...set.globals.values(),
        ...set.regions.flatMap((region) => [
            ...region.symbols.values(),
            ...region.scopes.flatMap((scope) => [...scope.symbols.values()]),
        ]),
    ]);
    for (const [name, place] of Object.entries(json.places)) {
        if (!names.has(name)) problems.push(`places has ${name}, which the set doesn't name`);
        if (!isPlace(place)) problems.push(`${name}'s place, "${place}", isn't a path and fragment`);
    }
}

/** Every set under `dir`, with its path relative to `dir` as the index gives it. */
export function readSets(dir = SymbolsDir) {
    return readdirSync(path.join(dir, SetsDir))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => {
            const file = `${SetsDir}/${name}`;
            return { file, json: JSON.parse(readFileSync(path.join(dir, file), "utf8")) };
        });
}

/** The sets that may be marked `system`, by their paths relative to `dir`. */
export function readMosSets(dir = SymbolsDir) {
    return JSON.parse(readFileSync(path.join(dir, MosSetsFile), "utf8"));
}

/** The sets that may be marked `system`, parsed. */
export const readSystemSets = (dir = SymbolsDir) =>
    readMosSets(dir).map((file) => parseSet(JSON.parse(readFileSync(path.join(dir, file), "utf8"))));

/** The globals of the sets that may be marked `system`, by address. */
export function systemGlobals(dir = SymbolsDir) {
    const globals = new Map();
    for (const set of readSystemSets(dir)) for (const [address, name] of set.globals) globals.set(address, name);
    return globals;
}

function checkNames(names, where, seen, problems) {
    const byAddress = new Map();
    for (const [name, address] of Object.entries(names ?? {})) {
        if (seen.has(name)) problems.push(`${name} is named in ${seen.get(name)} and again in ${where}`);
        seen.set(name, where);
        const value = parseAddress(address, name);
        if (byAddress.has(value))
            problems.push(`${hex(value)} has two names in ${where}, ${byAddress.get(value)} and ${name}`);
        byAddress.set(value, name);
    }
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** The containers the client reads with Object.entries, which would take an array as an object. */
function checkShape(json) {
    if (!isObject(json)) return ["it isn't a JSON object"];
    const problems = [];
    if (json.globals !== undefined && !isObject(json.globals)) problems.push("globals isn't an object of names");
    if (
        json.places !== undefined &&
        !(isObject(json.places) && Object.values(json.places).every((place) => typeof place === "string"))
    )
        problems.push("places isn't an object of names to text");
    if (!isObject(json.regions)) return [...problems, "regions isn't an object of regions"];
    for (const [name, region] of Object.entries(json.regions)) {
        if (!isObject(region)) {
            problems.push(`region ${name} isn't an object`);
            continue;
        }
        if (region.symbols !== undefined && !isObject(region.symbols))
            problems.push(`region ${name}'s symbols isn't an object of names`);
        if (region.anchors !== undefined && !(Array.isArray(region.anchors) && region.anchors.every(isObject)))
            problems.push(`region ${name}'s anchors isn't a list of anchors`);
        if (
            region.scopes !== undefined &&
            !(
                Array.isArray(region.scopes) &&
                region.scopes.every(
                    (scope) => isObject(scope) && (scope.symbols === undefined || isObject(scope.symbols)),
                )
            )
        )
            problems.push(`region ${name}'s scopes isn't a list of scopes with objects of names`);
    }
    return problems;
}

/**
 * What the build would reject in one set file: its schema and licence, its anchors' lengths,
 * places and number, `system` only on a set the MOS list names, and its names.
 * @returns {string[]} the problems, none for a good set
 */
export function checkSet(json, { file, mosSets }) {
    const shapeProblems = checkShape(json);
    if (shapeProblems.length) return shapeProblems;
    let set;
    try {
        set = parseSet(json);
    } catch (error) {
        return [error.message];
    }
    const problems = [];
    if (!RelativeJsonPath.test(file)) problems.push(`its path, ${file}, isn't one the debugger will fetch`);
    if (!isText(json.title)) problems.push("it has no title");
    if (!isText(json.licence)) problems.push("it has no licence");
    else if (GplFamily.test(json.licence))
        problems.push(`its licence is ${json.licence}, and names from GPL sources aren't used for sets`);
    if (!isText(json.source)) problems.push("it doesn't say where its names came from in source");
    if (json.notice !== undefined && !isText(json.notice)) problems.push("its notice isn't text");
    if (
        json.madeFrom !== undefined &&
        !(Array.isArray(json.madeFrom) && json.madeFrom.every((key) => ImageKey.test(key)))
    )
        problems.push("madeFrom isn't a list of image keys");
    if (json.link !== undefined) problems.push("it has a link, and linked sets aren't supported yet");
    if (json.system !== undefined && typeof json.system !== "boolean") problems.push("system isn't true or false");
    if (set.system && !mosSets.includes(file)) problems.push(`it's a system set, but ${MosSetsFile} doesn't list it`);
    if (set.regions.length === 0) problems.push("it has no regions");
    checkLinks(json, set, problems);

    for (const region of set.regions) {
        const where = `region ${region.name}`;
        if (region.anchors.length > 0 && region.anchors.length < region.minAnchors)
            problems.push(`${where} has ${region.anchors.length} anchors, fewer than its minAnchors`);
        for (const { at, bytes } of region.anchors) {
            const end = at + bytes.length;
            if (bytes.length < MinAnchorBytes || bytes.length > MaxAnchorBytes)
                problems.push(
                    `${where}'s anchor at ${hex(at)} is ${bytes.length} bytes, not ${MinAnchorBytes} to ${MaxAnchorBytes}`,
                );
            if (at < region.start || end > region.end) problems.push(`${where}'s anchor at ${hex(at)} runs outside it`);
            if (at < IoEnd && end > IoStart)
                problems.push(`${where}'s anchor at ${hex(at)} reads ${hex(IoStart)}-${hex(IoEnd - 1)}`);
        }
        for (const [address, name] of region.symbols)
            if (address < region.start || address >= region.end)
                problems.push(`${where} names ${hex(address)} (${name}), which is outside it`);
        const { scopes } = region;
        for (const scope of scopes)
            for (const [address, name] of scope.symbols)
                if (address >= region.start && address < region.end)
                    problems.push(
                        `${where}'s scope at ${hex(scope.start)} names ${hex(address)} (${name}), which is inside the region`,
                    );
        for (const [i, scope] of scopes.entries())
            for (const earlier of scopes.slice(0, i))
                if (earlier.start < scope.end && scope.start < earlier.end)
                    for (const [address, name] of scope.symbols)
                        if (earlier.symbols.has(address))
                            problems.push(
                                `${where}'s scopes at ${hex(earlier.start)} and ${hex(scope.start)} overlap and both name ${hex(address)} (${name})`,
                            );
    }

    const seen = new Map();
    checkNames(json.globals, "the globals", seen, problems);
    for (const [name, region] of Object.entries(json.regions ?? {})) {
        checkNames(region.symbols, `region ${name}`, seen, problems);
        for (const [i, scope] of (region.scopes ?? []).entries())
            checkNames(scope.symbols, `region ${name}'s scope ${i}`, new Map(), problems);
    }
    const globalAt = new Map([...set.globals].map(([address, name]) => [name, address]));
    const scopedAt = new Map();
    for (const region of set.regions)
        for (const scope of region.scopes)
            for (const [address, name] of scope.symbols) {
                if (globalAt.has(name) ? globalAt.get(name) !== address : seen.has(name))
                    problems.push(`${name} is named in ${seen.get(name)} and in a scope`);
                else if (scopedAt.has(name) && scopedAt.get(name) !== address)
                    problems.push(
                        `${name} names ${hex(scopedAt.get(name))} in one scope and ${hex(address)} in another`,
                    );
                scopedAt.set(name, address);
            }
    return problems;
}

/** The index the debugger fetches first, from the sets as `readSets` gives them. */
export function indexOf(sets) {
    return {
        format: Format,
        sets: sets.map(({ file, json }) => ({
            url: file,
            licence: json.licence,
            regions: Object.fromEntries(
                Object.entries(json.regions).map(([name, { symbols: _symbols, scopes: _scopes, ...region }]) => [
                    name,
                    region,
                ]),
            ),
        })),
    };
}

/** Text as `npm run format` would leave it at `file`. */
export async function formatText(text, file) {
    const options = await resolveConfig(file, { editorconfig: true });
    return prettier(text, { ...options, filepath: file });
}

/** JSON as `npm run format` would leave it at `file`. */
export const formatJson = (value, file) => formatText(JSON.stringify(value), file);

async function main() {
    const sets = readSets();
    const mosSets = readMosSets();
    const problems = sets.flatMap(({ file, json }) =>
        checkSet(json, { file, mosSets }).map((problem) => `${file}: ${problem}`),
    );
    if (problems.length) {
        console.error(problems.join("\n"));
        return 1;
    }
    const indexPath = path.join(SymbolsDir, IndexFile);
    writeFileSync(indexPath, await formatJson(indexOf(sets), indexPath));
    const titlesPath = path.join(SymbolsDir, TitlesFile);
    const rows = titleRows(readConfigs(SymbolsDir), new Map(sets.map(({ file, json }) => [file, json])));
    writeFileSync(titlesPath, await formatText(titlesMarkdown(rows), titlesPath));
    console.log(`Wrote ${IndexFile} with ${sets.length} sets, and ${TitlesFile} with ${rows.length} titles`);
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
