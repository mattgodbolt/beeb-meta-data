import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { headOf, licenceChanges, moved, movesOf, pinsOf, report } from "../../tools/symbols/refresh.js";

const ConfigsDir = new URL("../../symbols/configs/", import.meta.url);
const config = (name) => JSON.parse(readFileSync(new URL(name, ConfigsDir), "utf8"));

let repository;
const commits = {};

const git = (...args) =>
    execFileSync("git", ["-C", repository, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        encoding: "utf8",
    }).trim();

function commit(name, files) {
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
        writeFileSync(path.join(repository, file), text);
    }
    git("add", ".");
    git("commit", "--quiet", "-m", name);
    commits[name] = git("rev-parse", "HEAD");
}

beforeAll(() => {
    repository = mkdtempSync(path.join(tmpdir(), "refresh-test-"));
    git("init", "--quiet", "--initial-branch", "main");
    commit("first", { LICENSE: "MIT", "game.asm": "rts", "docs/LICENCE.txt": "CC0" });
    commit("code", { "game.asm": "nop\nrts" });
    git("checkout", "--quiet", "-b", "original", commits.first);
    commit("relicensed", { LICENSE: "GPL" });
    commit("nested", { "docs/LICENCE.txt": "CC-BY" });
    git("checkout", "--quiet", "main");
});

afterAll(() => rmSync(repository, { recursive: true, force: true }));

describe("pinsOf", () => {
    it("gives a level7 config's page", () => {
        const { source } = config("hopper.json");
        expect(pinsOf(config("hopper.json"))).toEqual([{ page: source.disassembly, pinned: source.sha256 }]);
    });

    it("gives a config's commit and the branch it follows", () => {
        expect(pinsOf(config("xmos-1992.json"))).toEqual([
            {
                repository: "https://github.com/mattgodbolt/xmos",
                branch: "original-licensed",
                pinned: "ac713efa9d4071029e7058c7f4bee549fe5111f0",
                names: true,
            },
        ]);
    });

    it("gives py8dis's commit too, as not the names' source", () => {
        const pins = pinsOf(config("repton2.json"));
        expect(pins.map(({ repository, names }) => [repository, names])).toEqual([
            ["https://github.com/gfoot/repton2disassembly", true],
            ["https://github.com/ZornsLemma/py8dis", false],
        ]);
    });
});

describe("headOf", () => {
    it("gives the default branch's head", () => {
        expect(headOf(repository)).toBe(commits.code);
    });

    it("gives a named branch's head", () => {
        expect(headOf(repository, "original")).toBe(commits.nested);
    });

    it("refuses a branch the repository hasn't", () => {
        expect(() => headOf(repository, "nope")).toThrow("has no branch nope");
    });
});

describe("licenceChanges", () => {
    it("is empty when only the code changed", () => {
        expect(licenceChanges(repository, commits.first, commits.code)).toEqual([]);
    });

    it("names a root licence file that changed", () => {
        expect(licenceChanges(repository, commits.first, commits.relicensed)).toEqual(["LICENSE"]);
    });

    it("names the config's licence file, wherever it is", () => {
        expect(licenceChanges(repository, commits.relicensed, commits.nested)).toEqual([]);
        expect(licenceChanges(repository, commits.relicensed, commits.nested, "docs/LICENCE.txt")).toEqual([
            "docs/LICENCE.txt",
        ]);
    });
});

describe("movesOf", () => {
    const pinned = (commit, branch) => ({ source: { repository, commit, ...(branch && { branch }) } });
    const latest = async ({ branch }) => headOf(repository, branch);

    it("moves a pin to its branch's head", async () => {
        expect(await movesOf(pinned(commits.first), latest)).toEqual([
            { repository, pinned: commits.first, to: commits.code, names: true },
        ]);
    });

    it("moves nothing at the head", async () => {
        expect(await movesOf(pinned(commits.code), latest)).toBeNull();
    });

    it("refuses to move past a licence change", async () => {
        await expect(movesOf(pinned(commits.first, "original"), latest)).rejects.toThrow("LICENSE changed between");
    });

    it("refuses to move two pins at one commit to different commits", async () => {
        const both = { ...pinned(commits.first), py8dis: { repository, commit: commits.first, branch: "original" } };
        const heads = async ({ branch }) => (branch ? commits.relicensed : commits.code);
        await expect(movesOf(both, heads)).rejects.toThrow("move to different commits");
    });
});

describe("moved", () => {
    it("moves every use of the commit, the notice's link included", () => {
        const text = JSON.stringify({ notice: `from ${repository}/tree/${commits.first}`, commit: commits.first });
        expect(moved(text, [{ pinned: commits.first, to: commits.code }])).toBe(
            JSON.stringify({ notice: `from ${repository}/tree/${commits.code}`, commit: commits.code }),
        );
    });
});

describe("report", () => {
    const xmos = "/x/symbols/configs/xmos.json";
    const from = "469fe35d08012c986fc1a367247b8ee040151f13";
    const to = "73cf1883b3444b8a2043351805c203acaf2b8b30";
    const github = { repository: "https://github.com/mattgodbolt/xmos", pinned: from, to };

    it("says when nothing moved", () => {
        expect(report({ kept: [], failed: [], refused: [] })).toBe("Every pin is at its latest.\n");
    });

    it("links a kept move's changes and lists the sets it changed", () => {
        const changed = new Map([[xmos, { names: ["xmos-rom.json"] }]]);
        expect(report({ kept: [{ moves: [{ file: xmos, pins: [github] }], changed }], failed: [], refused: [] }))
            .toBe(`Moved, remade and checked:

- \`xmos.json\`: [mattgodbolt/xmos](https://github.com/mattgodbolt/xmos/compare/${from}...${to}) moved from \`469fe35\` to \`73cf188\`; \`xmos-rom.json\` changed
`);
    });

    it("lists the titles a system set's move changed", () => {
        const mos = "/x/symbols/configs/bbc-b-mos.json";
        const changed = new Map([
            [mos, { names: ["bbc-b-mos-1.20.json"] }],
            ["/x/symbols/configs/kix.json", { names: ["kix-game.json"] }],
        ]);
        expect(
            report({ kept: [{ moves: [{ file: mos, pins: [github] }], changed }], failed: [], refused: [] }),
        ).toContain("A system set moved, which also changed `kix.json`.");
    });

    it("gives a failure's output and a refusal's reason", () => {
        const hopper = "/x/symbols/configs/hopper.json";
        const failure = { file: hopper, what: "in-memory check", output: "fail one\nfail two" };
        const text = report({
            kept: [],
            failed: [{ moves: [{ file: hopper, pins: [{ page: "https://l7/hopper.txt" }] }], failure }],
            refused: [{ file: xmos, reason: "LICENSE changed" }],
        });
        expect(text).toBe(`Left at their pins:

- \`xmos.json\`: LICENSE changed
- \`hopper.json\`: its in-memory check failed

  \`\`\`
  fail one
  fail two
  \`\`\`
`);
    });
});
