import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    aliasedSource,
    aliasValues,
    assemble,
    definitionsIn,
    instructionOf,
    parseReport,
    readBuild,
    sourceLines,
} from "../../tools/symbols/acme-build.js";

const Source = [
    ".workspace = $70 ; zero page",
    "* = $C000",
    ".start",
    "    lda #.workspace",
    ".loop sta .workspace,X",
    "lda $1234",
    '    !text "a long string of text", 0',
].join("\n");

describe("definitionsIn", () => {
    it("finds labels and assignments at the start of a line, but not mnemonics", () => {
        expect(definitionsIn(Source)).toEqual([
            { name: ".workspace", line: 1, label: false },
            { name: ".start", line: 3, label: true },
            { name: ".loop", line: 5, label: true },
        ]);
    });
});

describe("aliasedSource", () => {
    it("follows each defining line with a global alias named by its line", () => {
        const lines = aliasedSource(Source, definitionsIn(Source)).split("\n");
        expect(lines.slice(0, 5)).toEqual([
            ".workspace = $70 ; zero page",
            "jsbeeb_symbol_1 = .workspace",
            "* = $C000",
            ".start",
            "jsbeeb_symbol_3 = .start",
        ]);
        expect(lines).toHaveLength(Source.split("\n").length + 3);
    });
});

describe("aliasValues", () => {
    it("reads the aliases' values from ACME's symbol list, by line, ignoring the source's own globals", () => {
        const list = "\tjsbeeb_symbol_1\t= $70\t; unused\n\tjsbeeb_symbol_3\t= $c000\t; unused\n\tother\t= $12\n";
        expect([...aliasValues(list)]).toEqual([
            [1, 0x70],
            [3, 0xc000],
        ]);
    });
});

describe("parseReport", () => {
    it("reads each line's address and bytes, with null for bytes cut short, and its file", () => {
        const report = [
            "",
            "; ******** Source: mos.a.jsbeeb.a",
            "     1                          .workspace = $70",
            "     6  c000 a970                   lda #.workspace",
            '    13  c004 68656c6c6f20776f...!text "hello world long", 0',
        ].join("\n");
        expect(parseReport(report)).toEqual([
            { address: 0xc000, data: [0xa9, 0x70], file: "mos.a.jsbeeb.a", line: 6 },
            { address: 0xc004, data: null, file: "mos.a.jsbeeb.a", line: 13 },
        ]);
    });
});

describe("instructionOf", () => {
    it.each([
        ["    lda #.workspace", { code: true, base: null }],
        [".loop sta .workspace,X ; store", { code: true, base: ".workspace" }],
        ["    jmp (.vector)", { code: true, base: ".vector" }],
        ["    lda $1234,Y", { code: true, base: null }],
        ["    asl", { code: true, base: null }],
        ["    !byte .workspace", { code: false, base: null }],
        ["    sta+2 .workspace", { code: true, base: ".workspace" }],
    ])("reads %s", (text, expected) => {
        expect(instructionOf(text)).toEqual(expected);
    });
});

const Main = [
    ".port = $FE40",
    "* = $C000",
    ".start",
    "    lda #1",
    "    sta .port",
    ".message",
    '    !text "a message longer than eight", 13',
    '    !source "nops.a"',
    ".after rts",
    "",
].join("\n");
const Nops = "    nop\n    nop\n";
const Aliased = "main.a.jsbeeb.a";
// What ACME 0.97 gives for Main, aliased, and Nops.
const MainReport = `
; ******** Source: ${Aliased}
     1                          .port = $FE40
     2                          jsbeeb_symbol_1 = .port
     3                          * = $C000
     4                          .start
     5                          jsbeeb_symbol_3 = .start
     6  c000 a901                   lda #1
     7  c002 8d40fe                 sta .port
     8                          .message
     9                          jsbeeb_symbol_6 = .message
    10  c005 61206d6573736167...    !text "a message longer than eight", 13
    11                              !source "nops.a"

; ******** Source: nops.a
     1  c021 ea                     nop
     2  c022 ea                     nop
     3                          

; ******** Source: ${Aliased}
    12  c023 60                 .after rts
    13                          jsbeeb_symbol_9 = .after
    14                          

; ******** done
`;
const MainSymbols = [
    "\tjsbeeb_symbol_9\t= $c023\t; unused",
    "\tjsbeeb_symbol_1\t= $fe40\t; unused",
    "\tjsbeeb_symbol_3\t= $c000\t; unused",
    "\tjsbeeb_symbol_6\t= $c005\t; unused",
].join("\n");
const Message = [...Buffer.from("a message longer than eight"), 0x0d];
const MainBinary = Uint8Array.from([0xa9, 0x01, 0x8d, 0x40, 0xfe, ...Message, 0xea, 0xea, 0x60]);

describe("sourceLines", () => {
    it("maps each line of the aliased source back to the source's, and each alias to none", () => {
        const lines = sourceLines(definitionsIn(Main), Main.split("\n").length);
        expect(lines.slice(1, 14)).toEqual([1, undefined, 2, 3, undefined, 4, 5, 6, undefined, 7, 8, 9, undefined]);
    });
});

describe("readBuild", () => {
    const run = { file: Aliased, text: Main, symbolList: MainSymbols, report: MainReport, binary: MainBinary };

    it("reads the source's own statements at its own lines, filling in from the binary what the report cut short", () => {
        const { base, statements, definitions } = readBuild(run);
        expect(base).toBe(0xc000);
        expect(statements.map(({ address, data, line }) => [address, data.length, line])).toEqual([
            [0xc000, 2, 4],
            [0xc002, 3, 5],
            [0xc005, Message.length, 7],
            [0xc023, 1, 9],
        ]);
        expect(statements[2].data).toEqual(Message);
        expect(statements[3].text).toBe(".after rts");
        expect(definitions.map(({ name, value }) => [name, value])).toEqual([
            [".port", 0xfe40],
            [".start", 0xc000],
            [".message", 0xc005],
            [".after", 0xc023],
        ]);
    });

    it("refuses a run whose symbol list has no value for a name the source defines", () => {
        const missing = MainSymbols.split("\n").slice(1).join("\n");
        expect(() => readBuild({ ...run, symbolList: missing })).toThrow("ACME gave no value for .after");
    });
});

const Acme = process.env.ACME ?? "acme";
const hasAcme = !spawnSync(Acme, ["--version"]).error;

describe.skipIf(!hasAcme)("assemble, with ACME (set ACME to run it)", () => {
    it("gives what readBuild makes of the report, symbol list and binary", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "symbols-acme-test-"));
        try {
            writeFileSync(path.join(dir, "main.a"), Main);
            writeFileSync(path.join(dir, "nops.a"), Nops);
            const built = assemble(dir, "main.a", Acme);
            expect(built.binary).toEqual(MainBinary);
            const expected = readBuild({
                file: Aliased,
                text: Main,
                symbolList: MainSymbols,
                report: MainReport,
                binary: MainBinary,
            });
            expect(built.statements).toEqual(expected.statements);
            expect(built.definitions).toEqual(expected.definitions);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
