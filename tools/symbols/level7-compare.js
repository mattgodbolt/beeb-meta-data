#!/usr/bin/env node
/**
 * For choosing a level7 title's regions: boots a disc in a headless jsbeeb, runs it a while, and says how
 * much of each run of the disassembly's statements memory holds once the game has loaded and again after
 * the keys that start a game, which labels the PC was in just before each, and, given a config whose
 * sets are made, which of their anchors memory disagrees with. The disassembly is often of the tape
 * version, and a disc can load or relocate it differently.
 *
 * Usage: node tools/symbols/level7-compare.js --config symbols/configs/hopper.json [--source <file>]
 *            [--seconds 25] [--keys SPACE,RETURN] [--wait 3]
 *        node tools/symbols/level7-compare.js --disassembly <url> --disc Acornsoft/Monsters [--image <name>]
 *            [--seconds 25] [--keys SPACE] [--wait 3] [--draft <id>]
 *
 * The config needs only `source` and `disc`. Without one, `--disassembly` and `--disc`, a zip's path
 * under Stairway to Hell's disc images, stand in for them, and `--draft ID` writes
 * symbols/configs/ID.json and ID-check.js from what it found, regions and moments for a curator to
 * check, unless they're already there. KEYS are names in jsbeeb's BBC keymap, each pressed in turn
 * with WAIT seconds after it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { unzip } from "jsbeeb/src/archive.js";
import { BBC } from "jsbeeb/src/keymap.js";
import { format, resolveConfig } from "prettier";
import { fingerprint } from "../registry/fingerprint.js";
import { SymbolsDir, systemGlobals } from "./build-index.js";
import { fetchDisc, loadTitleSets, pressKey, runSeconds, startMachine } from "./check-memory.js";
import { hex, importLevel7, level7Text, partCalled } from "./import-level7.js";
import { readLevel7 } from "./level7-text.js";

const MemoryTop = 0x8000;
const KeyFrames = 50;
const ShortestRun = 16;
const DiscArchive = "https://bbc.xania.org/archive/sth/diskimages/";
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
const FewestLabels = 2;
// Every program's workspace, which a region's anchors can't tell apart.
const ZeroPageEnd = 0x100;
const Jsr = 0x20;
// Differing bytes closer than this are avoided as one range.
const AvoidGap = 16;
const FetchAttempts = 3;
const GameLoopNames = ["update_player", "main_game_loop"];
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
 * page or with fewer than two labels, and those overlapping a bigger one are left out. The biggest is
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
    const kept = [];
    const bySize = regions
        .filter(
            (r) =>
                r.end - r.start >= SmallestRegion &&
                r.start >= ZeroPageEnd &&
                r.part.labels.filter((l) => l.address >= r.start && l.address < r.end).length >= FewestLabels,
        )
        .sort((a, b) => b.end - b.start - (a.end - a.start));
    for (const region of bySize)
        if (!kept.some((other) => other.start < region.end && region.start < other.end)) kept.push(region);
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
async function hotLabels(session, labels) {
    const counts = new Map();
    for (let cycles = 0; cycles < SampleSecs * CyclesPerSecond; cycles += SampleCycles) {
        await session.runFor(SampleCycles);
        const found = (labels.get(session.registers().pc) ?? []).find(({ statement }) => {
            const held = session.readMemory(statement.address, statement.data.length);
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

async function sourceAndDisc(values) {
    if (values.config) {
        const config = JSON.parse(readFileSync(values.config, "utf8"));
        return { config, text: await level7Text(config, values.source), disc: await fetchDisc(config.disc) };
    }
    if (!values.disassembly || !values.disc)
        throw new Error("Give --config, or --disassembly and --disc to start a title");
    const response = await fetchRetrying(values.disassembly);
    if (!response.ok) throw new Error(`Fetching ${values.disassembly} failed with ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const url = `${DiscArchive}${values.disc}.zip`;
    const zip = await fetchRetrying(url);
    if (!zip.ok) throw new Error(`Fetching ${url} failed with ${zip.status}`);
    const members = await unzip(new Uint8Array(await zip.arrayBuffer()));
    const images = Object.keys(members).filter((name) => /\.[sd]sd$/i.test(name));
    const image = values.image ?? (images.length === 1 ? images[0] : undefined);
    if (!members[image]) throw new Error(`${url} holds ${images.join(", ")}; pick one with --image`);
    const config = {
        source: { disassembly: values.disassembly, sha256: createHash("sha256").update(bytes).digest("hex") },
        disc: { url, image, key: fingerprint(image, members[image]).discKey },
    };
    return { config, text: bytes.toString("latin1"), disc: members[image] };
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

function draftConfig(id, title, config, regions) {
    return {
        importer: "level7",
        id,
        licence: "LicenseRef-level7-educational",
        source: config.source,
        disc: config.disc,
        bytesPerAnchor: 2048,
        spreadAnchors: 4,
        check: `${id}-check.js`,
        sets: [
            {
                id: "game",
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

/**
 * Code for the check to wait for in a game, as `[set, region, name]`: a routine of the usual name for
 * the game's main loop if the draft's set has one, else the first of `hot` it names, so that it's a
 * name the import keeps; or undefined, saying why, if the draft doesn't import.
 */
function inGameLabel(draft, text, hot, regionOf, regions) {
    try {
        const [set] = importLevel7(draft, text, { systemGlobals: systemGlobals() }).sets;
        const playing = set.regions.filter((r) => regions.find((p) => p.name === r.name).heldAt.at(-1));
        for (const name of GameLoopNames) {
            const region = playing.find((r) => r.symbols.has(name));
            if (region) return ["game", region.name, name];
        }
        const label = hot.find((l) => set.regions.find((r) => r.name === regionOf(l).name).symbols.has(l.name));
        return label && ["game", regionOf(label).name, label.name];
    } catch (error) {
        console.log(`The draft doesn't import: ${error.message}`);
        return undefined;
    }
}

function draftCheck(title, regions, { seconds, keys, inGame }) {
    const at = (i) => JSON.stringify(regions.filter((r) => r.heldAt.at(i)).map((r) => `game/${r.name}`));
    return `/** ${title}${title.endsWith("s") ? "'" : "'s"} moments for tools/symbols/check-memory.js. */

import { playScenario } from "../../tools/symbols/title-scenario.js";

export const scenarios = {
    game: playScenario({
        loaded: ${at(0)},
        playing: ${at(-1)},
        loadSecs: ${seconds},
        start: ${JSON.stringify(keys)},
        inGame: ${JSON.stringify(inGame ?? ["game", "main", "TODO"])},
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

async function main() {
    const { values } = parseArgs({
        options: {
            config: { type: "string" },
            source: { type: "string" },
            disassembly: { type: "string" },
            disc: { type: "string" },
            image: { type: "string" },
            seconds: { type: "string", default: "25" },
            keys: { type: "string", default: "" },
            wait: { type: "string", default: "3" },
            draft: { type: "string" },
        },
    });
    const { config, text, disc: discBytes } = await sourceAndDisc(values);
    const { parts } = readLevel7(text);
    const keys = values.keys.split(",").filter(Boolean);
    for (const key of keys) if (BBC[key] === undefined) throw new Error(`There's no key ${key} in jsbeeb's BBC keymap`);
    const seconds = parseFloat(values.seconds);
    const labels = labelsByAddress(parts);
    const sets = values.config ? loadTitleSets(path.join(SymbolsDir, "sets"), config.id) : {};
    const moments = [];
    const temp = mkdtempSync(path.join(tmpdir(), "symbols-level7-"));
    try {
        const disc = path.join(temp, path.basename(config.disc.image));
        writeFileSync(disc, discBytes);
        const session = await startMachine(disc);
        try {
            await runSeconds(session, Math.max(0, seconds - SampleSecs));
            const sample = async (title) => {
                const hot = await hotLabels(session, labels);
                const memory = session.readMemory(0, MemoryTop);
                const comparison = compareWithMemory(parts, (at) => memory[at]);
                printMoment(`${title}, PC ${hex(session.registers().pc)}`, comparison, hot);
                printAnchors(sets, (at) => memory[at]);
                moments.push({ comparison, hot, memory });
            };
            await sample(`After ${seconds} seconds`);
            if (keys.length) {
                for (const key of keys) {
                    await pressKey(session, BBC[key], KeyFrames);
                    await runSeconds(session, parseFloat(values.wait));
                }
                await sample(`After ${keys.join(", ")}`);
            }
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
    if (keys.length)
        console.log(
            `Labels only after the keys, routines first: ${newHot
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
        const inGame = inGameLabel(draft, text, newHot, regionOf, regions);
        const check = draftCheck(title, regions, { seconds, keys, inGame });
        writeFileSync(
            configFile,
            await format(json, { ...(await resolveConfig(configFile, { editorconfig: true })), filepath: configFile }),
        );
        writeFileSync(
            checkFile,
            await format(check, { ...(await resolveConfig(checkFile, { editorconfig: true })), filepath: checkFile }),
        );
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
