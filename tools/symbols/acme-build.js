/**
 * Gets an ACME source at the commit its config names and assembles it the importer's way: in a copy of the
 * checkout, with `-r` for the report, which gives each line's address and bytes, and `-l` for the symbol
 * list. ACME lists only global symbols, and a disassembly's names are mostly local (`.name`), so the copy
 * it assembles has a global alias after each line of the source that defines a name.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkCommit, cloneCommit } from "./baron-build.js";
import { Mnemonics } from "./baron-listing.js";

export const AcmeOptions = { source: { type: "string" }, acme: { type: "string" } };
export const AcmeUsage = "[--source <checkout>] [--acme <path>]";

const MinimumVersion = [0, 97];
const VersionLine = /^This is ACME, release (\d+)\.(\d+)/;
const GitDir = ".git";
const AliasPrefix = "jsbeeb_symbol_";
const Definition = /^([.@]?[A-Za-z_]\w*)(?=[\s=;]|$)/;
const Assignment = /^\s*=/;
const SymbolListLine = new RegExp(String.raw`^\s*${AliasPrefix}(\d+)\s*=\s*\$([0-9a-fA-F]+)`, "gm");
const SourceHeader = /^; \*{8} Source: (.*)$/;
const ReportLine = /^ {0,5}(\d+) {2}(?:([0-9a-f]{4,}) ([0-9a-f]*)(\.\.\.)?)?/;
const Mnemonic = /^([A-Za-z]{3})(?:\+[123])?$/;
const OperandToken = /\$[0-9a-fA-F]+|%[01.#]+|\d+|"[^"]*"|'.'|([.@]?[A-Za-z_]\w*)|./g;
const Registers = new Set(["A", "X", "Y"]);

const withoutComment = (text) => text.replace(/;.*$/, "");
const isMnemonic = (word) => Mnemonics.has(Mnemonic.exec(word)?.[1].toUpperCase());

/**
 * The names a source defines at the start of a line, as a label (`.name`, or `.name lda #0`) or with `=`,
 * each with its line, from 1.
 * @returns {{name: string, line: number, label: boolean}[]}
 */
export function definitionsIn(text) {
    return text.split(/\r\n|\r|\n/).flatMap((line, i) => {
        const match = Definition.exec(line);
        if (!match || isMnemonic(match[1])) return [];
        return [{ name: match[1], line: i + 1, label: !Assignment.test(line.slice(match[1].length)) }];
    });
}

/** The source with `jsbeeb_symbol_<line> = <name>` after each line that defines a name. */
export function aliasedSource(text, definitions) {
    const byLine = new Map(definitions.map(({ name, line }) => [line, name]));
    return text
        .split(/\r\n|\r|\n/)
        .flatMap((line, i) => (byLine.has(i + 1) ? [line, `${AliasPrefix}${i + 1} = ${byLine.get(i + 1)}`] : [line]))
        .join("\n");
}

/**
 * The values ACME's symbol list gives the aliases, by the line of the source that defines each name.
 * @returns {Map<number, number>}
 */
export function aliasValues(symbolList) {
    return new Map(
        [...symbolList.matchAll(SymbolListLine)].map(([, line, value]) => [Number(line), parseInt(value, 16)]),
    );
}

/**
 * The statements ACME's report lists bytes for, in the order assembled: where each starts, its bytes
 * (or, where the report cuts them short with `...`, `null`), and its file and line as the report gives them.
 * @returns {{address: number, data: number[] | null, file: string, line: number}[]}
 */
export function parseReport(report) {
    const out = [];
    let file = null;
    for (const line of report.split(/\r\n|\r|\n/)) {
        const header = SourceHeader.exec(line);
        if (header) {
            file = header[1];
            continue;
        }
        const match = ReportLine.exec(line);
        if (!match?.[2]) continue;
        const [, number, address, hex, cut] = match;
        out.push({
            address: parseInt(address, 16),
            data: cut ? null : Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16)),
            file,
            line: Number(number),
        });
    }
    return out;
}

/**
 * Whether a line of source is an instruction, and the first name its operand is built on if it names
 * memory: not an immediate, a register or a number.
 * @returns {{code: boolean, base: string | null}}
 */
export function instructionOf(text) {
    const words = withoutComment(text).trim().split(/\s+/);
    const at = isMnemonic(words[0] ?? "") ? 0 : isMnemonic(words[1] ?? "") ? 1 : -1;
    if (at < 0) return { code: false, base: null };
    const operand = words.slice(at + 1).join(" ");
    if (operand.startsWith("#")) return { code: true, base: null };
    for (const [, name] of operand.matchAll(OperandToken))
        if (name && !Registers.has(name.toUpperCase())) return { code: true, base: name };
    return { code: true, base: null };
}

/** The first line of `acme --version`; refuses an ACME older than the importer reads, or one that can't be run. */
export function acmeVersion(acme) {
    const { stdout, error } = spawnSync(acme, ["--version"], { encoding: "utf8" });
    const version = stdout?.split("\n")[0].trim() ?? "";
    const match = VersionLine.exec(version);
    if (error || !match) throw new Error(`Can't run ACME as ${acme}: give --acme, or set ACME`, { cause: error });
    const [major, minor] = [parseInt(match[1]), parseInt(match[2])];
    if (major < MinimumVersion[0] || (major === MinimumVersion[0] && minor < MinimumVersion[1]))
        throw new Error(`${acme} is ${version}, and the importer needs ACME ${MinimumVersion.join(".")} or later`);
    return version;
}

/**
 * Where each line of the aliased source came from: the source's own line, or none for an alias.
 * @param {{line: number}[]} definitions - the source's, in order, as aliasedSource was given them
 * @returns {(number | undefined)[]} by the aliased source's line, from 1
 */
export function sourceLines(definitions, lineCount) {
    const aliases = new Set(definitions.map(({ line }, i) => line + i + 1));
    const out = [];
    for (let line = 1, skipped = 0; line <= lineCount + definitions.length; line++) {
        if (aliases.has(line)) skipped++;
        else out[line] = line - skipped;
    }
    return out;
}

/**
 * What one source's ACME run gave, as the importer reads it.
 * @param {object} run
 * @param {string} run.file - the aliased source's name, as the report's headers give it
 * @param {string} run.text - the source itself
 * @param {string} run.symbolList - from `-l`
 * @param {string} run.report - from `-r`
 * @param {Uint8Array} run.binary - from `-f plain`
 * @returns {{base: number, binary: Uint8Array, statements: object[], definitions: object[]}} the binary's
 *     lowest address and the binary; the source's own statements, with their bytes filled in from the
 *     binary where the report cut them short and `line` the source's own; and the names the source defines,
 *     each with its value
 */
export function readBuild({ file, text, symbolList, report, binary }) {
    const definitions = definitionsIn(text);
    const values = aliasValues(symbolList);
    const unvalued = definitions.filter(({ line }) => !values.has(line)).map(({ name }) => name);
    if (unvalued.length) throw new Error(`ACME gave no value for ${unvalued.join(", ")}`);
    const listed = parseReport(report);
    const base = Math.min(...listed.map(({ address }) => address));
    const lines = text.split(/\r\n|\r|\n/);
    const sourceLine = sourceLines(definitions, lines.length);
    const statements = [];
    listed.forEach((statement, i) => {
        if (statement.file !== file) return;
        let next = i + 1;
        while (next < listed.length && listed[next].address <= statement.address) next++;
        const end = next < listed.length ? listed[next].address : base + binary.length;
        const length = statement.data?.length ?? end - statement.address;
        const line = sourceLine[statement.line];
        statements.push({
            address: statement.address,
            data: Array.from(binary.subarray(statement.address - base, statement.address - base + length)),
            text: lines[line - 1],
            line,
        });
    });
    return { base, binary, statements, definitions: definitions.map((d) => ({ ...d, value: values.get(d.line) })) };
}

/** Assembles one source of the work directory, its path from the root, into plain binary, as readBuild reads it. */
export function assemble(workDir, source, acme) {
    const file = path.join(workDir, source);
    const text = readFileSync(file, "latin1");
    const aliased = `${file}.jsbeeb.a`;
    writeFileSync(aliased, aliasedSource(text, definitionsIn(text)), "latin1");
    const outputs = { binary: `${file}.bin`, report: `${file}.report`, symbols: `${file}.symbols` };
    const run = spawnSync(
        acme,
        ["-f", "plain", "-o", outputs.binary, "-r", outputs.report, "-l", outputs.symbols, path.basename(aliased)],
        { cwd: path.dirname(file), encoding: "utf8" },
    );
    if (run.error || run.status !== 0)
        throw new Error(`ACME failed on ${source}: ${run.stderr?.trim() || run.error?.message}`, { cause: run.error });
    try {
        return readBuild({
            file: path.basename(aliased),
            text,
            symbolList: readFileSync(outputs.symbols, "latin1"),
            report: readFileSync(outputs.report, "latin1"),
            binary: new Uint8Array(readFileSync(outputs.binary)),
        });
    } catch (error) {
        throw new Error(`${source}: ${error.message}`, { cause: error });
    }
}

/**
 * Runs `use` with the config's checkout and each of its sets' sources assembled, by the source's path, in
 * a temporary directory removed afterwards.
 * @param {{source?: string, acme?: string}} options - an existing checkout of the config's commit to
 *     assemble instead of fetching one, and the ACME to run (else ACME, else `acme` on the PATH)
 */
export async function withAcmeBuild(config, { source, acme } = {}, use) {
    const named = acme ?? process.env.ACME ?? "acme";
    const acmePath = path.basename(named) === named ? named : path.resolve(named);
    const version = acmeVersion(acmePath);
    const temp = mkdtempSync(path.join(tmpdir(), "symbols-acme-"));
    try {
        const sourceDir = source ?? path.join(temp, "source");
        if (source === undefined) cloneCommit(config.source, sourceDir);
        checkCommit(config.source, sourceDir);
        const workDir = path.join(temp, "work");
        cpSync(sourceDir, workDir, { recursive: true, filter: (from) => path.basename(from) !== GitDir });
        const builds = new Map(
            [...new Set(config.sets.map(({ assemble: file }) => file))].map((file) => [
                file,
                assemble(workDir, file, acmePath),
            ]),
        );
        return await use({ sourceDir, builds, acme: version });
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}
