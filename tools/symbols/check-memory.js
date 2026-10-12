#!/usr/bin/env node
/**
 * Checks a title's symbol sets against the title running in a headless jsbeeb: at moments its
 * curator's scenarios choose, which regions' anchors all match memory, as the debugger would see it
 * each time the machine stops, and whether that's exactly the regions expected there. A moment fails
 * if other regions match, or if two matching regions overlap, since the debugger then shows neither.
 *
 * Usage: node tools/symbols/check-memory.js --config symbols/configs/pipeline.json [--source <checkout>]
 *            [--baron <path>] [--beebasm <path>] [--sets symbols/sets] [--shots DIR] [SCENARIO...]
 *
 * The config's `check` names the module of scenarios, beside it, which can also export `machines`, the
 * machine each scenario wants by its name (see startMachine). They boot `source.disc`, the original
 * disc in the source repository, with the title built as its importer builds it, for the scenarios that
 * read its files; or `disc`, a disc image in a zip the config names by its URL, its path in the zip and
 * its key; or no disc, for a ROM's config. A ROM jsbeeb doesn't have, which the config's `rom` gives by
 * URL and key, or as the `file` an assembled title's build saves, is put in sideways RAM; for an acornaeology
 * config, the ROM of the version a scenario's machine names in `sideways`. An assembled title's scenario can boot
 * another `disc` or `rom` of its checkout instead (scenarioMedia). With no SCENARIO, it runs them all, each on a
 * fresh machine. Exits 1 if any moment fails.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { unzip } from "jsbeeb/src/archive.js";
import { BBC } from "jsbeeb/src/keymap.js";
import { MachineSession } from "jsbeeb/src/machine-session.js";
import { parseSet } from "jsbeeb/src/symbol-sets.js";
import { regionMatches } from "jsbeeb/src/symbol-names.js";
import { fingerprint } from "../registry/fingerprint.js";
import { SymbolsDir } from "./build-index.js";
import { fetchRom, romOf } from "./rom-images.js";
import { Assemblers, BuildOptions, BuildUsage, importerOf, withTitleSource } from "./title-build.js";

const CyclesPerSecond = 2000000;
const Model = "B-DFS1.2";
const SidewaysBase = 0x8000;
const SidewaysRamBank = 7;
const BootTimeoutSecs = 30;
const LineReadSecs = 2;
const DefaultKeyFrames = 3;
export const ReleaseFrames = 2;
const RandomMinHoldFrames = 5;
const RandomHoldFrameRange = 40;

const hex = (address) => `&${address.toString(16).toUpperCase().padStart(4, "0")}`;

/** The sets in `dir` with these ids, which are their files' names, by id. */
export const loadSets = (dir, ids) =>
    Object.fromEntries(ids.map((id) => [id, parseSet(JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8")))]));

/** A title's sets in `dir`, by set id: those whose files start with the config's id. */
export function loadTitleSets(dir, titleId) {
    const prefix = `${titleId}-`;
    return Object.fromEntries(
        readdirSync(dir)
            .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
            .sort()
            .map((name) => [
                name.slice(prefix.length, -".json".length),
                parseSet(JSON.parse(readFileSync(path.join(dir, name), "utf8"))),
            ]),
    );
}

/** Every region whose anchors all match, as "set/region", sorted. */
export function matchingRegions(sets, peek) {
    return Object.entries(sets)
        .flatMap(([id, set]) =>
            set.regions.filter((region) => regionMatches(region, peek)).map((region) => `${id}/${region.name}`),
        )
        .sort();
}

/** Pairs of matching regions over the same addresses, of one set or two: the debugger shows neither. */
export function overlappingRegions(sets, found) {
    const regionOf = (name) => {
        const [id, regionName] = name.split("/");
        return sets[id].regions.find((region) => region.name === regionName);
    };
    const out = [];
    found.forEach((a, i) => {
        for (const b of found.slice(i + 1)) {
            const ra = regionOf(a);
            const rb = regionOf(b);
            if (ra.start < rb.end && rb.start < ra.end) out.push(`${a} and ${b}`);
        }
    });
    return out;
}

/**
 * A machine with the disc in (if any), booted with SHIFT+BREAK: a B with DFS 1.2 unless `machine` names
 * another jsbeeb model, with a second processor if it says `tube`, and left at the prompt if it says
 * `autoboot: false`. A `sideways` ROM goes in sideways RAM before the machine starts.
 */
export async function startMachine(disc, { model = Model, tube = false, autoboot = true } = {}, sideways = null) {
    const session = new MachineSession(model, { tube });
    await session.initialise();
    if (sideways) session.writeMemory(SidewaysBase, [...sideways], { bank: SidewaysRamBank });
    await session.boot(BootTimeoutSecs);
    if (disc) session.loadDisc(disc);
    if (!autoboot) return session;
    session.keyDownRaw(BBC.SHIFT);
    try {
        session.reset(true);
        await session.runFor(CyclesPerSecond);
    } finally {
        session.keyUpRaw(BBC.SHIFT);
    }
    return session;
}

export const runSeconds = (session, seconds) => session.runFor(Math.round(seconds * CyclesPerSecond));

/** Presses a key by its matrix position, held for `frames`. */
export async function pressKey(session, key, frames = DefaultKeyFrames) {
    session.keyDownRaw(key);
    await session.runFrames(frames);
    session.keyUpRaw(key);
    await session.runFrames(ReleaseFrames);
}

/**
 * Types a line, which `session.type` ends with RETURN itself, stopping where the PC first reaches `address`,
 * as the command the line starts runs. Typing can end before the line is read (by a ROM that takes over
 * line input, say), so it runs on for a while after.
 */
export async function typeUntil(session, text, address) {
    const id = session.addBreakpoint("execute", address);
    try {
        await session.type(text);
        if (session.registers().pc !== address) await session.runFor(LineReadSecs * CyclesPerSecond);
    } finally {
        session.removeBreakpoint(id);
    }
    if (session.registers().pc !== address) throw new Error(`Typing ${text} never reached ${hex(address)}`);
}

/** Holds a key until the PC reaches `address`: a loop that waits for a key comes round while it's down. */
export async function holdUntil(session, key, address) {
    session.keyDownRaw(key);
    try {
        await session.runUntilAddress(address);
    } finally {
        session.keyUpRaw(key);
    }
}

/** A seeded linear congruential generator, so random play is the same each run. */
export function seededRandom(seed) {
    let state = seed;
    return (n) => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return Math.floor((state / 0x80000000) * n);
    };
}

/** Presses keys `random` picks from `keys`, each held a random while, for at least `frames` in all. */
export async function pressRandomKeys(session, keys, random, frames) {
    for (let pressed = 0; pressed < frames;) {
        const key = keys[random(keys.length)];
        const held = RandomMinHoldFrames + random(RandomHoldFrameRange);
        await pressKey(session, key, held);
        pressed += held + ReleaseFrames;
    }
}

/**
 * Runs a little script of host keys, each command one of: `wait SECS`, `key CODE [FRAMES]` (pressed and
 * released), `down CODE`, `up CODE`, `type TEXT`, and `shot NAME`, which saves NAME.png in `shots` if
 * that's given. CODE is a KeyboardEvent.code.
 */
export async function runScript(session, commands, { shots } = {}) {
    for (const command of commands) {
        const [op, ...args] = command.trim().split(/\s+/);
        switch (op) {
            case "wait":
                await runSeconds(session, parseFloat(args[0]));
                break;
            case "key":
                session.keyDown(args[0]);
                await session.runFrames(parseInt(args[1] ?? `${DefaultKeyFrames}`));
                session.keyUp(args[0]);
                await session.runFrames(ReleaseFrames);
                break;
            case "down":
                session.keyDown(args[0]);
                break;
            case "up":
                session.keyUp(args[0]);
                break;
            case "shot":
                if (shots) writeFileSync(path.join(shots, `${args[0]}.png`), await session.screenshotActive());
                break;
            case "type":
                await session.type(command.trim().slice("type ".length));
                break;
            default:
                throw new Error(`Unknown script command: ${command}`);
        }
    }
}

/**
 * The context a scenario gets: the machine, the sets, the build's built files, where to save screenshots (if anywhere),
 * `address(set, region, name)` for a symbol's address, and `check(moment, expected)`, which can take `{ bank }`
 * to look at that sideways bank instead of the one paged in.
 */
function scenarioContext(session, sets, filesDir, shots, results) {
    const address = (id, regionName, name) => {
        const region = sets[id]?.regions.find((r) => r.name === regionName);
        const found = region && [...region.symbols].find(([, symbol]) => symbol === name);
        if (!found) throw new Error(`There's no ${name} in ${id}/${regionName}`);
        return found[0];
    };
    const check = (moment, expected, { bank } = {}) => {
        const peek = (at) => session.readMemory(at, 1, { bank })[0];
        const found = matchingRegions(sets, peek);
        const want = [...expected].sort();
        const overlaps = overlappingRegions(sets, found);
        const ok = found.length === want.length && found.every((r, i) => r === want[i]) && !overlaps.length;
        const pc = session.registers().pc;
        const where = bank === undefined ? `PC ${hex(pc)}` : `PC ${hex(pc)}, bank ${bank}`;
        console.log(`${ok ? "ok  " : "FAIL"} ${moment} (${where}): ${found.join(", ") || "nothing"}`);
        if (!ok) {
            console.log(`     expected: ${want.join(", ")}`);
            for (const pair of overlaps) console.log(`     overlapping: ${pair}`);
        }
        results.push(ok);
    };
    return { session, sets, filesDir, shots, address, check };
}

/**
 * Fetches a zip of disc images and takes the one `image` names out of it, refusing it unless its key is `key`.
 * @returns {Promise<Uint8Array>}
 */
export async function fetchDisc({ url, image, key }) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetching ${url} failed with ${response.status}`);
    const members = await unzip(new Uint8Array(await response.arrayBuffer()));
    if (!members[image]) throw new Error(`${url} holds no ${image}`);
    const { discKey } = fingerprint(image, members[image]);
    if (discKey !== key) throw new Error(`${image} in ${url} is image ${discKey}, and the config names ${key}`);
    return members[image];
}

/**
 * Runs `use` with what a config's scenarios boot: for an assembled title, its build and checkout, with
 * `source.disc` in it if it names one; a disc the config's `disc` fetches from an archive; or no disc,
 * for a ROM's config that names none.
 */
async function withTitleDisc(config, options, use) {
    if (Assemblers.includes(importerOf(config))) {
        if (config.source.disc === undefined && config.rom === undefined)
            throw new Error("The config names no disc to boot in source.disc, and no rom");
        return withTitleSource(config, options, ({ sourceDir, filesDir, saved }) =>
            use({
                disc: config.source.disc === undefined ? null : path.join(sourceDir, config.source.disc),
                sourceDir,
                filesDir,
                saved,
            }),
        );
    }
    if (config.disc === undefined) {
        if (config.rom === undefined && !config.sets?.some(({ rom }) => rom !== undefined))
            throw new Error("The config names no disc to boot, in source.disc or disc");
        return use({ disc: null });
    }
    const temp = mkdtempSync(path.join(tmpdir(), "symbols-disc-"));
    try {
        const disc = path.join(temp, path.basename(config.disc.image));
        writeFileSync(disc, await fetchDisc(config.disc));
        return await use({ disc });
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}

/** The ROM a config puts in sideways RAM: one its build saves, one it fetches, or none for a ROM jsbeeb has. */
export async function sidewaysRom(config, saved) {
    if (config.rom?.file !== undefined) {
        const rom = saved?.get(config.rom.file);
        if (!rom) throw new Error(`The build saves no ${config.rom.file}`);
        return rom;
    }
    return typeof config.rom === "object" ? fetchRom(config.rom) : null;
}

/**
 * What a scenario's machine boots: the title's disc and ROM, unless its `machines` entry names a `disc`
 * or a `rom` of the title's checkout instead (the original release beside the rebuilt one, say).
 */
export function scenarioMedia(machine, sourceDir, disc, rom) {
    if ((machine.disc !== undefined || machine.rom !== undefined) && sourceDir === undefined)
        throw new Error("Only an assembled title's scenarios can boot a disc or ROM of its checkout");
    return {
        disc: machine.disc === undefined ? disc : path.join(sourceDir, machine.disc),
        rom: machine.rom === undefined ? rom : readFileSync(path.join(sourceDir, machine.rom)),
    };
}

async function main() {
    const { values, positionals } = parseArgs({
        options: {
            config: { type: "string" },
            ...BuildOptions,
            sets: { type: "string", default: path.join(SymbolsDir, "sets") },
            shots: { type: "string" },
        },
        allowPositionals: true,
    });
    if (!values.config) throw new Error(`Usage: check-memory.js --config <file> ${BuildUsage} [SCENARIO...]`);
    const config = JSON.parse(readFileSync(values.config, "utf8"));
    const sets =
        config.importer === "acornaeology"
            ? loadSets(
                  values.sets,
                  config.sets.map(({ id }) => id),
              )
            : loadTitleSets(values.sets, config.id);
    const { scenarios, machines = {} } = await import(
        pathToFileURL(path.resolve(path.dirname(values.config), config.check)).href
    );
    const wanted = positionals.length ? positionals : Object.keys(scenarios);
    for (const name of wanted) if (!scenarios[name]) throw new Error(`There's no scenario ${name}`);
    if (values.shots) mkdirSync(values.shots, { recursive: true });
    const results = [];
    const versionRom = (id) => {
        const version = config.sets.find((set) => set.id === id);
        if (!version) throw new Error(`There's no version ${id} to put in sideways RAM`);
        return romOf(version.rom);
    };
    await withTitleDisc(config, values, async ({ disc, sourceDir, filesDir, saved }) => {
        const configRom = await sidewaysRom(config, saved);
        for (const name of wanted) {
            console.log(`-- ${name}`);
            const machine = machines[name] ?? {};
            const rom = machine.sideways === undefined ? configRom : await versionRom(machine.sideways);
            const media = scenarioMedia(machine, sourceDir, disc, rom);
            const session = await startMachine(media.disc, machine, media.rom);
            try {
                await scenarios[name](scenarioContext(session, sets, filesDir, values.shots, results));
            } finally {
                session.destroy();
            }
        }
    });
    const failures = results.filter((ok) => !ok).length;
    console.log(`${results.length} moments, ${failures} failed`);
    return failures ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error.stack ?? error.message);
            process.exit(1);
        },
    );
}
