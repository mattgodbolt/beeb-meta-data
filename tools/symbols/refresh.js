#!/usr/bin/env node
/**
 * Moves every config's pinned sources to their latest, remakes the sets that changes, checks them, and writes what it
 * did as Markdown, for the pull request the weekly refresh workflow opens.
 *
 * Usage: node tools/symbols/refresh.js [--report FILE] [--corpus DIR] [CONFIG...]
 *
 * A git pin (`source.commit`, or `py8dis.commit`) moves to the head of its `branch`, else of the repository's default
 * branch; a level7 config's `source.sha256` moves to what its page hashes to now. A source whose licence file changed
 * stays where it is, since its `notice` has to be read again by a person. A move is kept only if every importer it
 * reruns succeeds, and every title whose sets change passes its in-memory check and (for any title but a ROM) its
 * corpus check against the Stairway to Hell discs in `--corpus`, which it fetches first if they aren't there;
 * otherwise its configs and sets go back as they were. A system set's move reruns every config, since the others leave
 * its addresses to it. Exits 1 if any move was refused or failed.
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
const RomImporters = ["acme", "acornaeology"];
const FailureLines = 30;
const ShortSha = 7;

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
    const run = spawnSync("git", args, { encoding: "utf8", ...options });
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
        return git(["-C", dir, "diff", "--name-only", from, to])
            .split("\n")
            .filter((name) => name === licenceFile || (!name.includes("/") && IsLicenceFile.test(name)));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function pageHash(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetching ${url} failed with ${response.status}`);
    return sha256(Buffer.from(await response.arrayBuffer()));
}

/**
 * Where a config's pins move to, each pin with its `to`, or nothing if none moves. Throws, saying why, if one can't
 * move: its licence changed, or two pins that share a commit move to different ones. `latest` looks a pin's new value
 * up, so that pins shared between configs are looked up once.
 */
export async function movesOf(config, latest) {
    const moves = [];
    for (const pin of pinsOf(config)) {
        const to = await latest(pin);
        if (to === pin.pinned) continue;
        if (pin.names) {
            const changed = licenceChanges(pin.repository, pin.pinned, to, config.source.licenceFile);
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
export const moved = (text, moves) => moves.reduce((result, { pinned, to }) => result.replaceAll(pinned, to), text);

function latestLookup() {
    const seen = new Map();
    return (pin) => {
        const key = pin.page ?? `${pin.repository} ${pin.branch ?? ""}`;
        if (!seen.has(key))
            seen.set(key, pin.page ? pageHash(pin.page) : Promise.resolve(headOf(pin.repository, pin.branch)));
        return seen.get(key);
    };
}

function snapshot(files) {
    return { configs: new Map(files.map((file) => [file, readFileSync(file, "utf8")])), sets: readSetFiles() };
}

function restore({ configs, sets }) {
    for (const [file, text] of configs) writeFileSync(file, text);
    const now = readSetFiles();
    for (const name of now.keys()) if (!sets.has(name)) unlinkSync(path.join(SetsDir, name));
    for (const [name, text] of sets) if (now.get(name) !== text) writeFileSync(path.join(SetsDir, name), text);
}

const tail = (run) =>
    `${run.stdout ?? ""}${run.stderr ?? ""}`.trimEnd().split("\n").slice(-FailureLines).join("\n") ||
    (run.error?.message ?? `exit ${run.status}`);

function step(file, what, run) {
    process.stdout.write(run.stdout ?? "");
    process.stderr.write(run.stderr ?? "");
    return run.status === 0 ? null : { file, what, output: tail(run) };
}

const Captured = { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 };

function runTool(script, args) {
    return spawnSync(process.execPath, [path.join(ToolsDir, script), ...args], Captured);
}

function checksOf(file, config, corpus) {
    const checks = [];
    if (config.check) checks.push(["in-memory check", () => runTool("check-memory.js", ["--config", file])]);
    if (!RomImporters.includes(config.importer))
        checks.push(["corpus check", () => runTool("corpus-check.js", ["--config", file, "--corpus", corpus()])]);
    return checks;
}

/**
 * Makes the moves, reruns their importers (every config's, if `everything`) and checks each title whose sets changed.
 * Returns the sets each config changed, or the first failure, after putting everything back.
 */
function attempt(moves, everything, corpus) {
    const before = snapshot(moves.map(({ file }) => file));
    for (const { file, pins } of moves) writeFileSync(file, moved(readFileSync(file, "utf8"), pins));
    const files = everything ? configFiles() : moves.map(({ file }) => file);
    const configs = files.map((file) => ({ file, config: JSON.parse(readFileSync(file, "utf8")) }));
    const changed = new Map();
    let failure = null;
    let current = moves[0].file;
    try {
        for (const { file, config } of systemFirst(configs)) {
            current = file;
            const sets = readSetFiles();
            failure = step(file, "import", runImporter(file, config, Captured));
            if (failure) break;
            const names = changedSets(sets, readSetFiles());
            if (names.length) changed.set(file, { config, names });
        }
        for (const [file, { config }] of failure ? [] : changed) {
            current = file;
            for (const [what, run] of checksOf(file, config, corpus)) {
                failure = step(file, what, run());
                if (failure) break;
            }
            if (failure) break;
        }
    } catch (error) {
        failure = { file: current, what: "refresh", output: error.message };
    }
    if (failure) restore(before);
    return failure ? { failure } : { changed };
}

function corpusFetcher(dir) {
    let fetched = false;
    return () => {
        if (!fetched) {
            const run = spawnSync(
                process.execPath,
                [
                    path.join(RepoDir, "tools/registry/fetch-corpus.js"),
                    "--out",
                    path.dirname(dir),
                    "--only",
                    "sth-disc",
                ],
                { stdio: "inherit" },
            );
            if (run.status !== 0) throw new Error("Fetching the corpus failed");
            fetched = true;
        }
        return dir;
    };
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

/** The pull request's body: what moved and what it changed, and what couldn't move and why. */
export function report({ kept, failed, refused }) {
    const lines = [];
    if (kept.length) {
        lines.push("Moved, remade and checked:", "");
        for (const { moves, changed } of kept)
            for (const { file, pins } of moves) {
                const names = changed.get(file)?.names ?? [];
                const sets = names.length ? `; ${names.map((name) => `\`${name}\``).join(", ")} changed` : "";
                lines.push(`- ${base(file)}: ${pins.map(describePin).join(", and ")}${sets}`);
            }
        const ripple = kept.flatMap(({ moves, changed }) =>
            [...changed.keys()].filter((file) => !moves.some((move) => move.file === file)),
        );
        if (ripple.length) lines.push("", `A system set moved, which also changed ${ripple.map(base).join(", ")}.`);
        lines.push("");
    }
    if (failed.length || refused.length) {
        lines.push("Left at their pins:", "");
        for (const { file, reason } of refused) lines.push(`- ${base(file)}: ${reason}`);
        for (const { moves, failure } of failed) {
            const what = moves.map(({ file }) => base(file)).join(", ");
            const whose = moves.length === 1 && moves[0].file === failure.file ? "its" : `${base(failure.file)}'s`;
            lines.push(
                `- ${what}: ${whose} ${failure.what} failed`,
                "",
                "  ```",
                ...failure.output.split("\n").map((line) => `  ${line}`),
                "  ```",
            );
        }
        lines.push("");
    }
    if (!lines.length) lines.push("Every pin is at its latest.", "");
    return lines.join("\n");
}

async function main() {
    const { values, positionals } = parseArgs({
        options: {
            report: { type: "string" },
            corpus: { type: "string", default: path.join(RepoDir, ".registry-corpus", "sth-disc") },
        },
        allowPositionals: true,
    });
    const files = positionals.length ? positionals.map((file) => path.resolve(file)) : configFiles();
    const latest = latestLookup();
    const moves = [];
    const refused = [];
    for (const file of files) {
        const config = JSON.parse(readFileSync(file, "utf8"));
        try {
            const pins = await movesOf(config, latest);
            if (pins) moves.push({ file, config, pins });
        } catch (error) {
            refused.push({ file, reason: error.message });
        }
    }
    const corpus = corpusFetcher(values.corpus);
    const kept = [];
    const failed = [];
    const system = moves.filter(({ config }) => config.system);
    const groups = [
        ...(system.length ? [[system, true]] : []),
        ...moves.filter(({ config }) => !config.system).map((move) => [[move], false]),
    ];
    for (const [group, everything] of groups) {
        const result = attempt(group, everything, corpus);
        if (result.failure) failed.push({ moves: group, failure: result.failure });
        else kept.push({ moves: group, changed: result.changed });
    }
    const index = spawnSync(process.execPath, [path.join(ToolsDir, "build-index.js")], { stdio: "inherit" });
    const text = report({ kept, failed, refused });
    if (values.report) writeFileSync(values.report, text);
    else process.stdout.write(text);
    return failed.length || refused.length || index.status !== 0 ? 1 : 0;
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
