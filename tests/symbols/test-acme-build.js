import { describe, expect, it } from "vitest";

import {
    aliasedSource,
    aliasValues,
    definitionsIn,
    instructionOf,
    parseReport,
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
