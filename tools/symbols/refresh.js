#!/usr/bin/env node
/**
 * Moves every config's pinned sources to their latest, remakes and checks the sets each move changes, and writes what it did
 * as Markdown, for the pull request the weekly refresh opens; "Running it" in docs/symbol-importers.md has the rules.
 *
 * Usage: node tools/symbols/refresh.js [--report FILE] [CONFIG...]
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Level7 } from "./import-level7.js";
import { changedSets, configFiles, readSetFiles, runImporter, SetsDir, systemFirst } from "./reimport-all.js";

const RepoDir = fileURLToPath(new URL("../../", import.meta.url));
const ToolsDir = fileURLToPath(new URL(".", import.meta.url));
const CorpusDir = path.join(RepoDir, ".registry-corpus");
const NoCorpusCheck = ["acme", "acornaeology"];
const FailureLines = 30;
const ShortSha = 7;
const MaxOutputBytes = 256 * 1024 * 1024;
// GitHub refuses a pull request body over 65,536 characters.
const MaxReportLength = 60000;
const FetchTimeoutMs = 60000;

/** A config's pins: each git commit, with where it moves to and whether it's the names' source, or a level7 page. */
export function pinsOf(config) {
    if (config.importer === Level7) return [{ page: config.source.disassembly, pinned: config.source.sha256 }];
    const git = ({ repository, commit, branch }, names) => ({ repository, branch, pinned: commit, names });
    return [
        ...(config.source?.commit ? [git(config.source, true)] : []),
        ...(config.py8dis?.commit ? [git(config.py8dis, false)] : []),
    ];
}

const git = (args, options = {}) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    const run = spawnSync("git", args, { encoding: "utf8", env, ...options });
    if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
    return run.stdout;
};

/** The commit at the head of `branch` in `repository`, or of its default branch. */
export function headOf(repository, branch) {
    const ref = branch ? `refs/heads/${branch}` : "HEAD";
    const commit = git(["ls-remote", repository, ref]).split(/\s/)[0];
    if (!commit) throw new Error(`${repository} has no ${branch ? `branch ${branch}` : "HEAD"}`);
    return commit;
}

const IsLicenceFile = /^(licen[cs]e|copying)(\.|$)/i;

/** The licence files at the root of `repository`, or `licenceFile`, that differ between commits `from` and `to`. */
export function licenceChanges(repository, from, to, licenceFile) {
    const dir = mkdtempSync(path.join(tmpdir(), "refresh-"));
    try {
        git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", repository, dir]);
        return git(["-C", dir, "diff", "--name-only", "--no-renames", from, to])
            .split("\n")
            .filter((name) => name === licenceFile || (!name.includes("/") && IsLicenceFile.test(name)));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function pageHash(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(FetchTimeoutMs) });
    if (!response.ok) throw new Error(`Fetching ${url} failed with ${response.status}`);
    return sha256(Buffer.from(await response.arrayBuffer()));
}

/**
 * Where a config's pins move to, each pin with its `to`, or nothing if none moves. Throws, saying why, if one can't
 * move: its licence changed, or two pins that share a commit move to different ones. `latest` looks up a pin's new
 * value and `licence` a source's changed licence files (licenceChanges), so that what configs share is looked up once.
 */
export async function movesOf(config, { latest, licence }) {
    const moves = [];
    for (const pin of pinsOf(config)) {
        const to = await latest(pin);
        if (to === pin.pinned) continue;
        if (pin.names) {
            const changed = licence(pin.repository, pin.pinned, to, config.source.licenceFile);
            if (changed.length)
                throw new Error(
                    `${changed.join(" and ")} changed between ${pin.pinned.slice(0, ShortSha)} and ` +
                        `${to.slice(0, ShortSha)}, so its notice needs reading again`,
                );
        }
        moves.push({ ...pin, to });
    }
    const target = new Map();
    for (const { pinned, to } of moves) {
        if (target.has(pinned) && target.get(pinned) !== to)
            throw new Error(`two pins at ${pinned.slice(0, ShortSha)} move to different commits`);
        target.set(pinned, to);
    }
    return moves.length ? moves : null;
}

/**
 * The config's text with each move made. A full commit or hash is unique, so every use of it moves together: the pin,
 * and the notice's link to the tree it was read from.
 */
export function moved(text, moves) {
    const to = new Map(moves.map((move) => [move.pinned, move.to]));
    return text.replace(new RegExp([...to.keys()].join("|"), "g"), (pinned) => to.get(pinned));
}

function once(lookup, key) {
    const seen = new Map();
    return (...args) => {
        const id = key(...args);
        if (!seen.has(id)) seen.set(id, lookup(...args));
        return seen.get(id);
    };
}

const latestOf = (pin) => (pin.page ? pageHash(pin.page) : Promise.resolve(headOf(pin.repository, pin.branch)));

const tail = (run) =>
    `${run.stdout ?? ""}${run.stderr ?? ""}`.trimEnd().split("\n").slice(-FailureLines).join("\n") ||
    (run.error?.message ?? `exit ${run.status}`);

function step(file, what, run) {
    process.stdout.write(run.stdout ?? "");
    process.stderr.write(run.stderr ?? "");
    return run.status === 0 ? null : { file, what, output: tail(run) };
}

/**
 * Makes `moves` in their configs, runs the importer of every config in `files`, and runs the checks of each one whose
 * sets changed. Returns the sets each config changed, or the first failure, after putting the moved configs and every
 * set in `setsDir` back as they were. `importer` and each of `checks`' runs give a spawnSync result.
 */
export function attempt(moves, { files, setsDir, importer, checks }) {
    const configsBefore = new Map(moves.map(({ file }) => [file, readFileSync(file, "utf8")]));
    const setsBefore = readSetFiles(setsDir);
    const changed = new Map();
    let failure = null;
    let current = moves[0].file;
    try {
        for (const { file, pins } of moves) writeFileSync(file, moved(configsBefore.get(file), pins));
        const configs = files.map((file) => ({ file, config: JSON.parse(readFileSync(file, "utf8")) }));
        for (const { file, config } of systemFirst(configs)) {
            current = file;
            const sets = readSetFiles(setsDir);
            failure = step(file, "import", importer(file, config));
            if (failure) break;
            const names = changedSets(sets, readSetFiles(setsDir));
            if (names.length) changed.set(file, { config, names });
        }
        for (const [file, { config }] of failure ? [] : changed) {
            current = file;
            for (const [what, run] of checks(file, config)) {
                failure = step(file, what, run());
                if (failure) break;
            }
            if (failure) break;
        }
    } catch (error) {
        failure = { file: current, what: "refresh", output: error.message };
    }
    if (!failure) return { changed };
    for (const [file, text] of configsBefore) writeFileSync(file, text);
    const now = readSetFiles(setsDir);
    for (const name of now.keys()) if (!setsBefore.has(name)) unlinkSync(path.join(setsDir, name));
    for (const [name, text] of setsBefore) if (now.get(name) !== text) writeFileSync(path.join(setsDir, name), text);
    return { failure };
}

const Captured = { encoding: "utf8", maxBuffer: MaxOutputBytes };

const runTool = (script, args) => spawnSync(process.execPath, [path.join(ToolsDir, script), ...args], Captured);

function corpusFetcher() {
    let fetched = false;
    return () => {
        if (!fetched) {
            const fetch = path.join(RepoDir, "tools/registry/fetch-corpus.js");
            const run = spawnSync(process.execPath, [fetch, "--out", CorpusDir, "--only", "sth-disc"], {
                stdio: "inherit",
            });
            if (run.status !== 0) throw new Error("Fetching the corpus failed");
            fetched = true;
        }
        return path.join(CorpusDir, "sth-disc");
    };
}

function checksOf(file, config, corpus) {
    const checks = [];
    if (config.check) checks.push(["in-memory check", () => runTool("check-memory.js", ["--config", file])]);
    if (!NoCorpusCheck.includes(config.importer))
        checks.push(["corpus check", () => runTool("corpus-check.js", ["--config", file, "--corpus", corpus()])]);
    return checks;
}

const short = (value) => `\`${value.slice(0, ShortSha)}\``;
const base = (file) => `\`${path.basename(file)}\``;

function describePin({ page, repository, pinned, to }) {
    if (page) return `[its disassembly](${page}) changed`;
    const name = repository.replace(/^https:\/\/github\.com\//, "");
    const range = `${short(pinned)} to ${short(to)}`;
    return repository.startsWith("https://github.com/")
        ? `[${name}](${repository}/compare/${pinned}...${to}) moved from ${range}`
        : `${repository} moved from ${range}`;
}

function fenced(text) {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return ["", `  ${fence}`, ...text.split("\n").map((line) => `  ${line}`), `  ${fence}`];
}

function reportLines({ kept, failed, refused, indexBuilt = true }, outputs) {
    const lines = [];
    if (kept.length) {
        lines.push("Moved, remade and checked:", "");
        for (const { moves, changed } of kept)
            for (const { file, pins } of moves) {
                const names = changed.get(file)?.names ?? [];
                const sets = names.length ? `; ${names.map((name) => `\`${name}\``).join(", ")} changed` : "";
                lines.push(`- ${base(file)}: ${[...new Set(pins.map(describePin))].join(", and ")}${sets}`);
            }
        for (const { moves, changed, leftOut = [] } of kept) {
            const ripple = [...changed.keys()].filter((file) => !moves.some((move) => move.file === file));
            if (ripple.length) lines.push("", `The system sets' move also changed ${ripple.map(base).join(", ")}.`);
            if (leftOut.length)
                lines.push(
                    "",
                    `${leftOut.map(base).join(", ")} weren't remade against the new system sets, since their pages ` +
                        "changed and their moves failed; their next move remakes them.",
                );
        }
        lines.push("");
    }
    if (failed.length || refused.length) {
        lines.push("Left at their pins:", "");
        for (const { file, reason } of refused) lines.push(`- ${base(file)}: ${reason}`);
        for (const { moves, failure } of failed) {
            const what = moves.map(({ file }) => base(file)).join(", ");
            const whose = moves.length === 1 && moves[0].file === failure.file ? "its" : `${base(failure.file)}'s`;
            lines.push(`- ${what}: ${whose} ${failure.what} failed`, ...(outputs ? fenced(failure.output) : []));
        }
        if (!outputs && failed.length) lines.push("", "The run's log has each failure's output.");
        lines.push("");
    }
    if (!indexBuilt) lines.push("Building the index failed; the run's log says why.", "");
    if (!lines.length) lines.push("Every pin is at its latest.", "");
    return lines.join("\n");
}

/** The pull request's body: what moved and what it changed, and what couldn't move and why. */
export function report(outcome) {
    const text = reportLines(outcome, true);
    return text.length <= MaxReportLength ? text : reportLines(outcome, false);
}

/**
 * Tries each title's moves on its own, then the system sets' together over every config in `files` but a level7 one
 * whose page changed and whose move failed, which can't be remade at a hash its page no longer has.
 * `tryMoves(group, files)` gives attempt's result.
 */
export function refreshMoves(moves, files, tryMoves) {
    const kept = [];
    const failed = [];
    const run = (group, groupFiles, leftOut = []) => {
        const result = tryMoves(group, groupFiles);
        if (result.failure) failed.push({ moves: group, failure: result.failure });
        else kept.push({ moves: group, changed: result.changed, leftOut });
    };
    for (const move of moves.filter(({ config }) => !config.system)) run([move], [move.file]);
    const system = moves.filter(({ config }) => config.system);
    if (system.length) {
        const stuck = new Set(
            failed
                .flatMap((failure) => failure.moves)
                .filter(({ config }) => config.importer === Level7)
                .map(({ file }) => file),
        );
        run(
            system,
            files.filter((file) => !stuck.has(file)),
            files.filter((file) => stuck.has(file)),
        );
    }
    return { kept, failed };
}

/** 1 if a move was refused or failed or the index wasn't built, which fails the workflow's run. */
export const exitCode = ({ failed, refused, indexBuilt }) => (failed.length || refused.length || !indexBuilt ? 1 : 0);

async function main() {
    const { values, positionals } = parseArgs({
        options: { report: { type: "string" } },
        allowPositionals: true,
    });
    const files = positionals.length ? positionals.map((file) => path.resolve(file)) : configFiles();
    const lookups = {
        latest: once(latestOf, (pin) => pin.page ?? `${pin.repository} ${pin.branch ?? ""}`),
        licence: once(licenceChanges, (...args) => args.join(" ")),
    };
    const moves = [];
    const refused = [];
    for (const file of files) {
        const config = JSON.parse(readFileSync(file, "utf8"));
        try {
            const pins = await movesOf(config, lookups);
            if (pins) moves.push({ file, config, pins });
        } catch (error) {
            refused.push({ file, config, reason: error.message });
        }
    }
    const corpus = corpusFetcher();
    const tools = {
        setsDir: SetsDir,
        importer: (file, config) => runImporter(file, config, Captured),
        checks: (file, config) => checksOf(file, config, corpus),
    };
    const tryMoves = (group, groupFiles) => attempt(group, { ...tools, files: groupFiles });
    const { kept, failed } = refreshMoves(moves, configFiles(), tryMoves);
    const index = spawnSync(process.execPath, [path.join(ToolsDir, "build-index.js")], { stdio: "inherit" });
    const outcome = { kept, failed, refused, indexBuilt: index.status === 0 };
    const text = report(outcome);
    if (values.report) writeFileSync(values.report, text);
    else process.stdout.write(text);
    return exitCode(outcome);
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
