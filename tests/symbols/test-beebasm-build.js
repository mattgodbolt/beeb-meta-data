import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fingerprint } from "../../tools/registry/fingerprint.js";
import { environmentWithoutGit } from "../../tools/symbols/baron-build.js";
import {
    assemble,
    assignedNames,
    beebasmVersion,
    definitionLines,
    markedSource,
    memoryOperandNames,
    PlacePrefix,
    PrintPrefix,
    withBeebasmBuild,
    wrapperSource,
} from "../../tools/symbols/beebasm-build.js";

// Acts as beebasm 1.11 would on the importer's wrapper: a PRINT of `scoped` stops it as an undefined
// symbol, its PUTFILE fails until the file it puts is there, and its SAVE fails until the directory it
// saves into is there.
const StubBeebasm = `#!/bin/sh
if [ "$1" = "--help" ]; then echo "beebasm 1.11"; echo; echo "Possible options:"; exit 0; fi
wrapper=$2
labels=$6
echo "Including file $wrapper" >&2
echo "Including file src/main.asm" >&2
line=$(grep -n ', scoped$' "$wrapper" | cut -d: -f1)
if [ -n "$line" ]; then echo "$wrapper:$line: error: Symbol not defined."; exit 1; fi
if [ ! -f gen/MAP ]; then
    printf 'src/main.asm:3: error: Error opening file.\n\nPUTFILE "gen/MAP", "MAP", &3000\n' >&2; exit 1
fi
if [ ! -d out ]; then echo "Error: out/PROG: Could not open object file for writing." >&2; exit 1; fi
printf 'ABC' > out/PROG
echo "[{'.start':6400L}]" > "$labels"
echo ".start"
echo "Saving file 'out/PROG'"
if grep -q ', ptr$' "$wrapper"; then echo "${PrintPrefix}:ptr:112 "; fi
`;

// Acts as beebasm would on a source whose IF 0 skips the lines up to its ELSE or ENDIF: PRINTs the importer's place
// marks on every other line.
const IfStubBeebasm = `#!/bin/sh
if [ "$1" = "--help" ]; then echo "beebasm 1.11"; exit 0; fi
echo "Including file src/main.asm" >&2
echo "[{'.start':6400L}]" > "$6"
awk '/^IF 0/ { skip = 1 } /^(ELSE|ENDIF)/ { skip = 0 } !skip' src/main.asm | grep -o '${PlacePrefix}:[^"]*' || true
`;

const DiscBytes = 2560;
const DiscFill = 0xe5;

const stubVersion = (version) => `#!/bin/sh\necho "${version}"\n`;

describe("a beebasm build", () => {
    let dir;
    const stub = (name, text) => {
        const file = path.join(dir, name);
        writeFileSync(file, text);
        chmodSync(file, 0o755);
        return file;
    };

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "symbols-beebasm-test-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("names the version it runs, and refuses one too old or one that won't run", () => {
        expect(beebasmVersion(stub("new", stubVersion("beebasm 1.11")))).toBe("beebasm 1.11");
        expect(beebasmVersion(stub("newer", stubVersion("beebasm 2.0")))).toBe("beebasm 2.0");
        expect(() => beebasmVersion(stub("old", stubVersion("beebasm 1.10")))).toThrow("1.11 or later");
        expect(() => beebasmVersion(path.join(dir, "nowhere"))).toThrow("Can't run beebasm");
    });

    it("hands `use` the config with the disc's key as its madeFrom", async () => {
        const repo = path.join(dir, "repo");
        mkdirSync(repo);
        const git = (...args) =>
            execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
                encoding: "utf8",
                env: environmentWithoutGit(),
            }).trim();
        git("init", "-q");
        const disc = Buffer.alloc(DiscBytes, DiscFill);
        writeFileSync(path.join(repo, "main.asm"), "RTS\n");
        writeFileSync(path.join(repo, "demo.ssd"), disc);
        git("add", ".");
        git("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "source");
        const beebasm = stub(
            "beebasm",
            '#!/bin/sh\nif [ "$1" = "--help" ]; then echo "beebasm 1.11"; exit 0; fi\necho "[{}]" > "$6"\n',
        );
        const config = {
            id: "demo",
            source: {
                assembler: "beebasm",
                repository: pathToFileURL(repo).href,
                commit: git("rev-parse", "HEAD"),
                assemble: "main.asm",
                disc: "demo.ssd",
            },
        };
        const made = await withBeebasmBuild(config, { beebasm }, (built) => built.config);
        expect(made.madeFrom).toEqual([fingerprint("demo.ssd", disc).discKey]);
    });

    it("refuses a baron title before running anything", async () => {
        await expect(withBeebasmBuild({ id: "demo", source: {} }, { beebasm: "/nowhere" }, () => {})).rejects.toThrow(
            "demo's source is assembled with baron",
        );
    });

    it("drops nested names, stands in for unput files, makes SAVEs' directories, reads the results", () => {
        const work = path.join(dir, "work");
        mkdirSync(path.join(work, "src"), { recursive: true });
        writeFileSync(path.join(work, "src", "main.asm"), "ptr = &70\n{\nscoped = 1\n}\n.start LDA ptr\n");
        const config = { source: { assemble: "src/main.asm" } };
        const made = assemble(config, work, path.join(dir, "build"), stub("beebasm", StubBeebasm));
        expect(made.names).toEqual(["ptr"]);
        expect(readFileSync(path.join(work, "gen", "MAP"))).toEqual(Buffer.alloc(0));
        expect(made.listing).toContain(`${PrintPrefix}:ptr:112`);
        expect(made.dump).toContain("'.start':6400L");
        expect([...made.saved]).toEqual([["out/PROG", Buffer.from("ABC")]]);
        expect(made.operandNames).toEqual(new Map([["ptr", new Set(["src/main.asm"])]]));
        expect(made.definitions).toEqual(
            new Map([
                ["ptr", ["src/main.asm#L1"]],
                ["{}.scoped", ["src/main.asm#L3"]],
                ["start", ["src/main.asm#L5"]],
            ]),
        );
        expect(existsSync(path.join(dir, "build", "marked"))).toBe(false);
    });

    it("keeps the place beebasm assembles of a name an IF and its ELSE define, leaving the work copy unmarked", () => {
        const work = path.join(dir, "work");
        mkdirSync(path.join(work, "src"), { recursive: true });
        const source =
            ".start\nIF 0\n.dup RTS\nELSE\n.dup NOP ; taken\nENDIF\n.once\n.twice\n.twice\nIF 0\n.gone\n.gone\nENDIF\n";
        writeFileSync(path.join(work, "src", "main.asm"), source);
        const config = { source: { assemble: "src/main.asm" } };
        const made = assemble(config, work, path.join(dir, "build"), stub("beebasm", IfStubBeebasm));
        expect(made.definitions).toEqual(
            new Map([
                ["start", ["src/main.asm#L1"]],
                ["dup", ["src/main.asm#L5"]],
                ["once", ["src/main.asm#L7"]],
                ["twice", ["src/main.asm#L8", "src/main.asm#L9"]],
                ["gone", []],
            ]),
        );
        expect(readFileSync(path.join(work, "src", "main.asm"), "latin1")).toBe(source);
    });
});

describe("markedSource", () => {
    it("PRINTs a line's place after each statement on it that defines a name, outside strings and comments", () => {
        const text = [
            '.a RTS ; "a;b"',
            '.b EQUS "x;y\\\\z" \\\\ note',
            ".c",
            ".d",
            "IF 0 : .e NOP : ENDIF : f = 1",
        ].join("\r\n");
        const print = (line) => `:PRINT "${PlacePrefix}:src/q""t.asm#L${line}"`;
        expect(markedSource(text, [1, 2, 4, 5], 'src/q"t.asm').split("\n")).toEqual([
            `.a RTS ${print(1)}; "a;b"`,
            `.b EQUS "x;y\\\\z" ${print(2)}\\\\ note`,
            ".c",
            `.d${print(4)}`,
            `IF 0 : .e NOP ${print(5)}: ENDIF : f = 1${print(5)}`,
        ]);
    });
});

describe("a beebasm build's stand-ins", () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "symbols-beebasm-put-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    // Acts as beebasm would on a PUTFILE of `file` that it can never open.
    const failingPut = (file) => {
        const stub = path.join(dir, "beebasm");
        const error = `main.asm:3: error: Error opening file.\\n\\nPUTFILE "${file}", "MAP", &3000\\n`;
        writeFileSync(stub, `#!/bin/sh\nprintf '${error}' >&2\nexit 1\n`);
        chmodSync(stub, 0o755);
        const work = path.join(dir, "work");
        mkdirSync(work, { recursive: true });
        return () => assemble({ source: { assemble: "main.asm" } }, work, path.join(dir, "build"), stub);
    };

    it("refuses a file it can't open though it's there", () => {
        expect(failingPut("gen/MAP")).toThrow("beebasm can't read gen/MAP");
    });

    it("never stands in for a file outside the checkout", () => {
        expect(failingPut("../outside/MAP")).toThrow("beebasm can't read ../outside/MAP");
        expect(existsSync(path.join(dir, "outside"))).toBe(false);
    });
});

describe("assignedNames", () => {
    it("finds every `=` name, after a colon too, and the conditional kind", () => {
        expect(assignedNames("ptr = &70\n  count=3 : max =? 9\n.loop LDA ptr\nIF x == 1\n")).toEqual([
            "ptr",
            "count",
            "max",
        ]);
    });
});

describe("definitionLines", () => {
    it("finds each label and `=` name with its line, in every statement, outside strings and comments", () => {
        const text = [
            "ptr = &70 : .start LDA ptr",
            '  PRINT "a:.b = 1" ; .commented = 2',
            "\\ .old_label",
            ".loop: count=3",
            "LDA #':' : .after_char",
            "IF x == 1",
            "  .^up",
        ].join("\n");
        expect(definitionLines(text)).toEqual([
            ["ptr", 1],
            ["start", 1],
            ["loop", 4],
            ["count", 4],
            ["after_char", 5],
            ["up", 7],
        ]);
    });
});

describe("definitionLines with braces", () => {
    it("qualifies a name with the labels that name its braces, as beebasm's dump does", () => {
        const text = [
            ".routine",
            "{",
            "  .loop DEX : BNE loop",
            "  {",
            "    .inner RTS",
            "  }",
            "  .*exported",
            "}",
            ".after LDA #0 : {",
            "  .hidden",
            "}",
            "{",
            "  .*entry",
            "  .private",
            "}",
            ".last",
        ].join("\n");
        expect(definitionLines(text)).toEqual([
            ["routine", 1],
            ["routine.loop", 3],
            ["routine.{}.inner", 5],
            ["routine.exported", 7],
            ["after", 9],
            ["{}.hidden", 10],
            ["{}.entry", 13],
            ["entry.private", 14],
            ["last", 16],
        ]);
    });
});

describe("memoryOperandNames", () => {
    it("finds the first name of each operand that isn't immediate", () => {
        expect(
            memoryOperandNames(
                ".a lda ptr+1\n  STA (vec),Y : LDX #KEY\n  JSR OSWRCH\n  ldy table, X\n  ASL A\n.inc_thing RTS\n" +
                    "  STZ flag\n",
            ),
        ).toEqual(["ptr", "vec", "OSWRCH", "table", "A", "flag"]);
    });
});

describe("wrapperSource", () => {
    it("INCLUDEs the source, then PRINTs each name with the importer's prefix", () => {
        expect(wrapperSource('/src/a "b".asm', ["ptr", "count"]).split("\n")).toEqual([
            'INCLUDE "/src/a ""b"".asm"',
            `PRINT "${PrintPrefix}:ptr:", ptr`,
            `PRINT "${PrintPrefix}:count:", count`,
            "",
        ]);
    });
});
