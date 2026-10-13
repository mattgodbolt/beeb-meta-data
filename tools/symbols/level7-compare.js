#!/usr/bin/env node
/**
 * For choosing a level7 title's regions: boots a disc in a headless jsbeeb, runs it a while, and says how
 * much of each run of the disassembly's statements memory holds once the game has loaded and again after
 * the keys that start a game, which labels the PC was in just before each, and, given a config whose
 * sets are made, which of their anchors memory disagrees with. The disassembly is often of the tape
 * version, and a disc can load or relocate it differently.
 *
 * Usage: node tools/symbols/level7-compare.js --config symbols/configs/hopper.json [--source <file>] [--boot-tape]
 *            [--seconds 25] [--keys SPACE,RETURN] [--wait 3] [--model Master] [--script <commands>] [--shots DIR]
 *            [--shadow]
 *        node tools/symbols/level7-compare.js --disassembly <url> (--disc Acornsoft/Monsters | --tape Acornsoft/Hunt)
 *            [--image <name>] [--seconds 25] [--keys SPACE] [--wait 3] [--model Master] [--draft <id>]
 *
 * The config needs only `source` and `disc` or `tape`; it boots the disc if it has both, unless `--boot-tape`.
 * Without one, `--disassembly` and `--disc` or `--tape`, a zip's path under Stairway to Hell's disc or tape
 * images, stand in for them, and `--draft ID` writes symbols/configs/ID.json and ID-check.js from what it
 * found, regions and moments for a curator to check, unless they're already there. KEYS are key steps
 * (title-scenario.js's keyStep), each taken in turn with WAIT seconds after it. A SCRIPT, instead, is
 * check-memory.js's runScript commands separated by `;`, where `report` says how much memory holds there;
 * the script's end does too. A draft needs KEYS, not a SCRIPT, for its check's start. On a Master, `--shadow` reads
 * shadow RAM rather than main at &3000 to &7FFF, for code a game keeps there.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { unzip } from "jsbeeb/src/archive.js";
import { findModel } from "jsbeeb/src/models.js";
import { format, resolveConfig } from "prettier";
import { fingerprint } from "../registry/fingerprint.js";
import { SymbolsDir, systemGlobals } from "./build-index.js";
import { publishedUrl } from "../registry/mirrors.js";
import { decodeTape, tapeKey } from "../registry/tape.js";
import {
    bootsTape,
    fetchDisc,
    fetchTape,
    loadTitleSets,
    Model,
    runScript,
    runSeconds,
    startMachine,
} from "./check-memory.js";
import { hex, importLevel7, Level7, level7Text, partCalled } from "./import-level7.js";
import { readLevel7 } from "./level7-text.js";
import { keyStep, pressStep } from "./title-scenario.js";

const MemoryTop = 0x8000;
const KeyFrames = 50;
const ShortestRun = 16;
const Archives = {
    disc: { mirror: "sth-disc", images: /\.[sd]sd$/i },
    tape: { mirror: "sth-tape", images: /\.uef$/i },
};
// A run this much the same as memory is the code that's there.
const Held = 0.9;
// Runs of one part closer than this make one region.
const MergeGap = 0x100;
const SampleCycles = 10007;
const SampleSecs = 3;
const CyclesPerSecond = 2000000;
const HotLabels = 12;
const DraftMoves = ["Z", "X", "COLON_STAR", "SLASH", "RETURN", "SPACE"];
// Smaller regions are usually a few bytes of data (envelopes, characters) that anchor poorly.
const SmallestRegion = 0x80;
// A region overlapping a bigger one by no more than this loses the overlap rather than being left out.
const TrimmableOverlap = 0x40;
const FewestLabels = 2;
// Every program's workspace, which a region's anchors can't tell apart.
const ZeroPageEnd = 0x100;
const Jsr = 0x20;
// Differing bytes closer than this are avoided as one range.
const AvoidGap = 16;
const FetchAttempts = 3;
const GameLoopNames = ["update_player", "main_game_loop"];
const DraftSetId = "game";
const DraftLicence = "LicenseRef-level7-educational";
const DraftBytesPerAnchor = 2048;
const DraftSpreadAnchors = 4;
const RegionObject = /\{\n\s*("name": [^{}]*?)\n\s*\}/g;

/**
 * Each part's runs of consecutive statements, with how many of their bytes below &8000 `peek` agrees
 * with, leaving out bytes the disassembly says change as the program runs.
 * @returns {{part: string, runs: {start: number, end: number, line: number, held: number, same: number}[]}[]}
 */
export function compareWithMemory(parts, peek) {
    return parts.map((part) => {
        const runs = [];
        let run = null;
        for (const statement of part.statements) {
            if (!run || statement.address !== run.end) {
                run = { start: statement.address, end: statement.address, line: statement.line, held: 0, same: 0 };
                runs.push(run);
            }
            run.end = statement.address + statement.data.length;
            if (statement.modified) continue;
            statement.data.forEach((byte, i) => {
                const at = statement.address + i;
                if (at >= MemoryTop) return;
                run.held++;
                if (peek(at) === byte) run.same++;
            });
        }
        return { part: part.name, runs };
    });
}

const share = ({ held, same }) => (held ? same / held : 0);

/**
 * Regions for a draft config from the comparisons at each moment (`compareWithMemory`'s, in the same
 * order): every run memory holds at some moment, those of a part within MergeGap of each other and held
 * at the same moments made one, each with whether it's held at each moment. Small ones, those in zero
 * page or with fewer than two labels, and those overlapping a bigger one are left out, unless the overlap
 * is at one end and small, when it's cut off instead. The biggest is
 * `main`; the others are named by their page, or else their first label. A region gets its part when
 * another part has statements there.
 */
export function proposeRegions(parts, moments) {
    const regions = [];
    parts.forEach((part, p) => {
        const held = moments[0][p].runs
            .map((run, r) => ({ run, at: moments.map((m) => m[p].runs[r]) }))
            .filter(({ run, at }) => run.end - run.start >= ShortestRun && at.some((m) => share(m) >= Held))
            .sort((a, b) => a.run.start - b.run.start);
        let current = null;
        for (const { run, at } of held) {
            const heldAt = at.map((m) => share(m) >= Held).join();
            if (current && run.start - current.end <= MergeGap && heldAt === current.heldAt) {
                current.end = Math.max(current.end, run.end);
                at.forEach((m, i) => {
                    current.held[i] += m.held;
                    current.same[i] += m.same;
                });
                continue;
            }
            current = {
                heldAt,
                part,
                start: run.start,
                end: run.end,
                held: at.map((m) => m.held),
                same: at.map((m) => m.same),
            };
            regions.push(current);
        }
    });
    const worthKeeping = (r) =>
        r.end - r.start >= SmallestRegion &&
        r.start >= ZeroPageEnd &&
        r.part.labels.filter((l) => l.address >= r.start && l.address < r.end).length >= FewestLabels;
    const kept = [];
    const bySize = regions.filter(worthKeeping).sort((a, b) => b.end - b.start - (a.end - a.start));
    for (const region of bySize) {
        for (const other of kept) {
            if (!(other.start < region.end && region.start < other.end)) continue;
            if (other.start <= region.start && other.end - region.start <= TrimmableOverlap) region.start = other.end;
            else if (other.end >= region.end && region.end - other.start <= TrimmableOverlap) region.end = other.start;
            else {
                region.end = region.start;
                break;
            }
        }
        if (region.start < region.end && worthKeeping(region)) kept.push(region);
    }
    kept.sort((a, b) => regions.indexOf(a) - regions.indexOf(b));
    const biggest = kept.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a), kept[0]);
    const names = new Set();
    return kept.map((region) => {
        const label = region.part.labels.find((l) => l.address >= region.start && l.address < region.end);
        const page = region.start % 0x100 === 0 ? `page${(region.start >> 8).toString(16)}` : undefined;
        let name = region === biggest ? "main" : (page ?? label?.name ?? `at${hex(region.start).slice(1)}`);
        while (names.has(name)) name = `${name}_${hex(region.start).slice(1)}`;
        names.add(name);
        const shared = parts.some(
            (other) =>
                other !== region.part &&
                other.statements.some((s) => s.address >= region.start && s.address < region.end),
        );
        return {
            name,
            ...(shared ? { part: partCalled(parts, region.part) } : {}),
            from: hex(region.start),
            to: hex(region.end),
            heldAt: region.held.map((held, i) => share({ held, same: region.same[i] }) >= Held),
            of: region.part,
            start: region.start,
            end: region.end,
        };
    });
}

/** Each address's labels, one for each part with a statement there: the last at or before it, with that statement. */
function labelsByAddress(parts) {
    const labels = new Map();
    for (const part of parts) {
        const sorted = part.labels.map((label) => ({ ...label, part })).sort((a, b) => a.address - b.address);
        let next = 0;
        for (const statement of [...part.statements].sort((a, b) => a.address - b.address)) {
            while (next < sorted.length && sorted[next].address <= statement.address) next++;
            const label = sorted[next - 1];
            if (!label) continue;
            for (let at = statement.address; at < statement.address + statement.data.length; at++) {
                if (!labels.has(at)) labels.set(at, []);
                labels.get(at).push({ label, statement });
            }
        }
    }
    return labels;
}

/** Where the PC was over a few seconds, by the label of the part whose statement memory holds there, most often first. */
async function hotLabels(session, labels, paging) {
    const counts = new Map();
    for (let cycles = 0; cycles < SampleSecs * CyclesPerSecond; cycles += SampleCycles) {
        await session.runFor(SampleCycles);
        const found = (labels.get(session.registers().pc) ?? []).find(({ statement }) => {
            const held = session.readMemory(statement.address, statement.data.length, paging);
            return statement.data.every((byte, i) => held[i] === byte);
        });
        if (found) counts.set(found.label, (counts.get(found.label) ?? 0) + 1);
    }
    return [...counts].sort(([, a], [, b]) => b - a);
}

/** level7's server drops some connections when several drafts start at once. */
async function fetchRetrying(url) {
    for (let attempt = 1; ; attempt++)
        try {
            return await fetch(url);
        } catch (error) {
            if (attempt === FetchAttempts) throw error;
        }
}

/** The config, the disassembly's text, and what to boot: a disc's bytes or a tape's name and bytes. */
export async function sourceAndMedia(values) {
    if (values.config) {
        const config = JSON.parse(readFileSync(values.config, "utf8"));
        if (config.disc === undefined && config.tape === undefined)
            throw new Error(`${values.config} names no disc or tape to boot`);
        const text = await level7Text(config, values.source);
        if (bootsTape(config.disc !== undefined, config.tape !== undefined, values["boot-tape"]))
            return { config, text, tape: { name: config.tape.image, data: await fetchTape(config.tape) } };
        return { config, text, disc: await fetchDisc(config.disc) };
    }
    if (values["boot-tape"]) throw new Error("--boot-tape picks a config's tape; give --tape to start a title");
    const kind = values.tape ? "tape" : "disc";
    if (!values.disassembly || !values[kind] || (values.tape && values.disc))
        throw new Error("Give --config, or --disassembly and one of --disc and --tape to start a title");
    const response = await fetchRetrying(values.disassembly);
    if (!response.ok) throw new Error(`Fetching ${values.disassembly} failed with ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const url = publishedUrl(`${Archives[kind].mirror}/${values[kind]}.zip`);
    const zip = await fetchRetrying(url);
    if (!zip.ok) throw new Error(`Fetching ${url} failed with ${zip.status}`);
    const members = await unzip(new Uint8Array(await zip.arrayBuffer()));
    const images = Object.keys(members).filter((name) => Archives[kind].images.test(name));
    const image = values.image ?? (images.length === 1 ? images[0] : undefined);
    if (!members[image]) throw new Error(`${url} holds ${images.join(", ")}; pick one with --image`);
    const data = members[image];
    const source = { disassembly: values.disassembly, sha256: createHash("sha256").update(bytes).digest("hex") };
    const text = bytes.toString("latin1");
    if (kind === "tape")
        return {
            config: { source, tape: { url, image, key: tapeKey(decodeTape(data).files) } },
            text,
            tape: { name: image, data },
        };
    return { config: { source, disc: { url, image, key: fingerprint(image, data).discKey } }, text, disc: data };
}

/**
 * Where memory disagrees with a region's statements at a moment it's held, as `avoid` ranges, so that
 * no anchor lands on code the disc version has changed or the program has written over.
 */
export function differingSpans(region, moments) {
    const differing = new Set();
    for (const [i, { memory }] of moments.entries()) {
        if (!region.heldAt[i]) continue;
        for (const { address, data, modified } of region.of.statements)
            if (!modified && address >= region.start && address < region.end)
                data.forEach((byte, offset) => {
                    const at = address + offset;
                    if (at < region.end && memory[at] !== byte) differing.add(at);
                });
    }
    const spans = [];
    for (const at of [...differing].sort((a, b) => a - b)) {
        const last = spans.at(-1);
        if (last && at - last[1] <= AvoidGap) last[1] = at + 1;
        else spans.push([at, at + 1]);
    }
    return spans.map(([from, to]) => [hex(from), hex(to)]);
}

/** A draft config from `proposeRegions`' regions, each with its `avoid` from `differingSpans`. */
export function draftConfig(id, title, config, regions) {
    return {
        importer: Level7,
        id,
        licence: DraftLicence,
        source: config.source,
        disc: config.disc,
        tape: config.tape,
        bytesPerAnchor: DraftBytesPerAnchor,
        spreadAnchors: DraftSpreadAnchors,
        check: `${id}-check.js`,
        sets: [
            {
                id: DraftSetId,
                title,
                regions: regions.map(({ name, part, from, to, heldAt, avoid }) => ({
                    name,
                    ...(part ? { part } : {}),
                    from,
                    to,
                    ...(heldAt[0] && !heldAt.at(-1) ? { overwritten: true } : {}),
                    ...(avoid.length ? { avoid } : {}),
                })),
            },
        ],
    };
}

/** The draft's set as the importer makes it, or undefined, saying why, if the draft doesn't import. */
function importedDraftSet(draft, text) {
    try {
        return importLevel7(draft, text, { systemGlobals: systemGlobals() }).sets[0];
    } catch (error) {
        console.log(`The draft doesn't import: ${error.message}`);
        return undefined;
    }
}

/**
 * Code for the check to wait for in a game, as `[set, region, name]`: a routine of the usual name for
 * the game's main loop if `set` keeps one in a region held in a game, else the first of `hot` (labels
 * the PC was only in after the keys) it keeps.
 */
export function inGameLabel(set, regions, hot, regionOf) {
    const playing = set.regions.filter((r) => regions.find((p) => p.name === r.name).heldAt.at(-1));
    for (const name of GameLoopNames) {
        const region = playing.find((r) => r.symbols.has(name));
        if (region) return [DraftSetId, region.name, name];
    }
    const label = hot.find((l) => set.regions.find((r) => r.name === regionOf(l)?.name)?.symbols.has(l.name));
    return label && [DraftSetId, regionOf(label).name, label.name];
}

export function draftCheck(title, regions, { seconds, keys, inGame, model }) {
    const at = (i) => JSON.stringify(regions.filter((r) => r.heldAt.at(i)).map((r) => `${DraftSetId}/${r.name}`));
    const machines = model ? `\nexport const machines = { game: { model: ${JSON.stringify(model)} } };\n` : "";
    return `/** ${title}${title.endsWith("s") ? "'" : "'s"} moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";
${machines}
export const scenarios = {
    game: playScenario({
        loaded: ${at(0)},
        playing: ${at(-1)},
        loadSecs: ${seconds},
        start: ${JSON.stringify(keys)},
        inGame: ${JSON.stringify(inGame ?? [DraftSetId, "main", "TODO"])},
        moves: ${JSON.stringify(DraftMoves)},
    }),
};
`;
}

/** The made sets' regions whose anchors don't all match, with what memory holds at each that doesn't. */
function printAnchors(sets, peek) {
    for (const [id, set] of Object.entries(sets))
        for (const region of set.regions) {
            const wrong = region.anchors.filter(({ at, bytes }) => bytes.some((byte, i) => peek(at + i) !== byte));
            if (!wrong.length) continue;
            const shown = wrong.map(
                ({ at, bytes }) =>
                    `${hex(at)} ${Buffer.from(bytes).toString("hex")} is ${Buffer.from(bytes.map((_, i) => peek(at + i) ?? 0)).toString("hex")}`,
            );
            console.log(`  ${id}/${region.name} doesn't match: ${shown.join(", ")}`);
        }
}

function printMoment(title, comparison, hot) {
    console.log(title);
    for (const { part, runs } of comparison) {
        const shown = runs.filter((r) => r.end - r.start >= ShortestRun);
        if (!shown.length) continue;
        console.log(`  ${part}:`);
        for (const run of shown)
            console.log(
                `    ${hex(run.start)}-${hex(run.end - 1)} (line ${run.line}): ${Math.round(100 * share(run))}%`,
            );
    }
    console.log(`  hot labels: ${hot.map(([{ name }, n]) => `${name} ${n}`).join(", ") || "none"}`);
}

function positiveSeconds(option, text) {
    const seconds = Number(text);
    if (!(seconds > 0)) throw new Error(`--${option} is a number of seconds above 0, not ${text}`);
    return seconds;
}

/** Runs the tool on `args`, its command line's arguments. */
export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            config: { type: "string" },
            source: { type: "string" },
            disassembly: { type: "string" },
            disc: { type: "string" },
            image: { type: "string" },
            seconds: { type: "string", default: "25" },
            tape: { type: "string" },
            "boot-tape": { type: "boolean" },
            keys: { type: "string", default: "" },
            wait: { type: "string", default: "3" },
            model: { type: "string" },
            script: { type: "string" },
            shots: { type: "string" },
            draft: { type: "string" },
            shadow: { type: "boolean" },
        },
    });
    const seconds = positiveSeconds("seconds", values.seconds);
    const wait = positiveSeconds("wait", values.wait);
    const { config, text, disc: discBytes, tape } = await sourceAndMedia(values);
    const { parts } = readLevel7(text);
    const keys = values.keys.split(",").filter(Boolean);
    const steps = keys.map((key) => keyStep(key, KeyFrames));
    if (keys.length && values.script) throw new Error("Give --keys or --script, not both");
    if (values.draft && values.script)
        throw new Error("--draft needs --keys, which become the check's start; a script's moments can't");
    if (values.shadow && values.draft) throw new Error("--draft can't use --shadow: a draft's check reads main RAM");
    if (values.shadow && !findModel(values.model ?? Model).isMaster)
        throw new Error("--shadow needs a Master, the only model with shadow RAM: give --model Master");
    const paging = values.shadow ? { shadow: true } : {};
    const script = (values.script ?? "")
        .split(";")
        .map((command) => command.trim())
        .filter(Boolean);
    if (values.shots) mkdirSync(values.shots, { recursive: true });
    const labels = labelsByAddress(parts);
    const sets = values.config ? loadTitleSets(path.join(SymbolsDir, "sets"), config) : {};
    const moments = [];
    const temp = mkdtempSync(path.join(tmpdir(), "symbols-level7-"));
    try {
        const disc = discBytes ? path.join(temp, path.basename(config.disc.image)) : null;
        if (disc) writeFileSync(disc, discBytes);
        const session = await startMachine(disc, { model: values.model }, null, tape);
        try {
            await runSeconds(session, Math.max(0, seconds - SampleSecs));
            const sample = async (title) => {
                const hot = await hotLabels(session, labels, paging);
                const memory = session.readMemory(0, MemoryTop, paging);
                const comparison = compareWithMemory(parts, (at) => memory[at]);
                printMoment(`${title}, PC ${hex(session.registers().pc)}`, comparison, hot);
                printAnchors(sets, (at) => memory[at]);
                moments.push({ comparison, hot, memory });
            };
            await sample(`After ${seconds} seconds`);
            if (keys.length) {
                for (const step of steps) {
                    await pressStep(session, step);
                    await runSeconds(session, wait);
                }
                await sample(`After ${keys.join(", ")}`);
            }
            let since = [];
            for (const command of script) {
                if (command !== "report") {
                    await runScript(session, [command], { shots: values.shots });
                    since.push(command);
                    continue;
                }
                await sample(`After ${since.join("; ") || "nothing more"}`);
                since = [];
            }
            if (since.length) await sample(`After ${since.join("; ")}`);
        } finally {
            session.destroy();
        }
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
    const regions = proposeRegions(
        parts,
        moments.map((m) => m.comparison),
    ).map((region) => ({ ...region, avoid: differingSpans(region, moments) }));
    const before = new Set(moments[0].hot.map(([label]) => label));
    const called = new Set(
        parts.flatMap((part) => part.statements.filter((s) => s.code && s.data[0] === Jsr).map((s) => s.base)),
    );
    const regionOf = (label) =>
        regions.find((r) => r.of === label.part && label.address >= r.start && label.address < r.end);
    const newHot = moments
        .at(-1)
        .hot.filter(([label]) => !before.has(label) && regionOf(label))
        .map(([label]) => label)
        .sort((a, b) => Number(called.has(b.address)) - Number(called.has(a.address)));
    console.log("Regions:");
    for (const r of regions) {
        const overlaps = regions.filter((o) => o !== r && o.start < r.end && r.start < o.end).map((o) => o.name);
        const part = r.part ? ` (${r.part})` : "";
        console.log(
            `  ${r.name} ${r.from}-${r.to}${part} held: ${r.heldAt.join(", ")}${overlaps.length ? `; overlaps ${overlaps.join(", ")}` : ""}`,
        );
    }
    if (moments.length > 1)
        console.log(
            `Labels only at the end, routines first: ${newHot
                .slice(0, HotLabels)
                .map((l) => `${regionOf(l).name}/${l.name}`)
                .join(", ")}`,
        );
    if (values.draft) {
        const title = /^(.*?)\s+disassembly\s*$/im.exec(text)?.[1] ?? values.draft;
        const configFile = path.join(SymbolsDir, "configs", `${values.draft}.json`);
        const checkFile = path.join(SymbolsDir, "configs", `${values.draft}-check.js`);
        if (existsSync(configFile) || existsSync(checkFile))
            throw new Error(`${configFile} or its check is already there`);
        const draft = draftConfig(values.draft, title, config, regions);
        const json = JSON.stringify(draft, null, 2).replace(
            RegionObject,
            (_, body) => `{ ${body.replace(/\n\s*/g, " ")} }`,
        );
        const set = importedDraftSet(draft, text);
        const inGame = set && inGameLabel(set, regions, newHot, regionOf);
        const formatted = async (source, file) =>
            format(source, { ...(await resolveConfig(file, { editorconfig: true })), filepath: file });
        const configText = await formatted(json, configFile);
        const checkText = await formatted(
            draftCheck(title, regions, { seconds, keys, inGame, model: values.model }),
            checkFile,
        );
        writeFileSync(checkFile, checkText);
        writeFileSync(configFile, configText);
        console.log(`Wrote ${configFile} and ${checkFile}`);
    }
    return 0;
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
