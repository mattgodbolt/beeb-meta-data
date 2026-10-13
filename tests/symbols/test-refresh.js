import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
    attempt,
    exitCode,
    headOf,
    licenceChanges,
    moved,
    movesOf,
    pinsOf,
    refreshMoves,
    report,
} from "../../tools/symbols/refresh.js";

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
        const source = { disassembly: "https://l7/hopper.txt", sha256: "ab".repeat(32) };
        expect(pinsOf({ importer: "level7", source })).toEqual([{ page: source.disassembly, pinned: source.sha256 }]);
    });

    it("gives a config's commit and the branch it follows", () => {
        const source = { repository: "https://github.com/a/b", commit: "c1", branch: "old" };
        expect(pinsOf({ source })).toEqual([
            { repository: "https://github.com/a/b", branch: "old", pinned: "c1", names: true },
        ]);
    });

    it("gives py8dis's commit too, as not the names' source", () => {
        const config = { source: { repository: "r", commit: "c1" }, py8dis: { repository: "p", commit: "c2" } };
        expect(pinsOf(config).map(({ repository, names }) => [repository, names])).toEqual([
            ["r", true],
            ["p", false],
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
    const lookups = { latest: async ({ branch }) => headOf(repository, branch), licence: licenceChanges };

    it("moves a pin to its branch's head", async () => {
        expect(await movesOf(pinned(commits.first), lookups)).toEqual([
            { repository, pinned: commits.first, to: commits.code, names: true },
        ]);
    });

    it("moves nothing at the head", async () => {
        expect(await movesOf(pinned(commits.code), lookups)).toBeNull();
    });

    it("refuses to move past a licence change", async () => {
        await expect(movesOf(pinned(commits.first, "original"), lookups)).rejects.toThrow("LICENSE changed between");
    });

    it("refuses to move two pins at one commit to different commits", async () => {
        const both = { ...pinned(commits.first), py8dis: { repository, commit: commits.first, branch: "original" } };
        const heads = async ({ branch }) => (branch ? commits.relicensed : commits.code);
        await expect(movesOf(both, { latest: heads, licence: licenceChanges })).rejects.toThrow(
            "move to different commits",
        );
    });
});

describe("moved", () => {
    it("moves every use of the commit", () => {
        const text = JSON.stringify({ commit: commits.first, py8dis: { commit: commits.first } });
        expect(moved(text, [{ pinned: commits.first, to: commits.code }])).toBe(
            JSON.stringify({ commit: commits.code, py8dis: { commit: commits.code } }),
        );
    });

    it("moves each pin once, even where one moves to where another was", () => {
        const moves = [
            { pinned: "a".repeat(40), to: "b".repeat(40) },
            { pinned: "b".repeat(40), to: "c".repeat(40) },
        ];
        expect(moved(`${"a".repeat(40)} ${"b".repeat(40)}`, moves)).toBe(`${"b".repeat(40)} ${"c".repeat(40)}`);
    });
});

describe("attempt", () => {
    let dir;
    let setsDir;
    const ok = { status: 0, stdout: "", stderr: "" };
    const failing = (output) => ({ status: 1, stdout: output, stderr: "" });
    const configFile = (id, config) => {
        const file = path.join(dir, `${id}.json`);
        writeFileSync(file, JSON.stringify({ id, ...config }));
        return file;
    };
    const setFile = (name) => path.join(setsDir, name);
    const read = (file) => readFileSync(file, "utf8");
    // Writes the set the config's commit gives, as an importer does, and a new one from the commit "grown".
    const importer = (file, config) => {
        writeFileSync(setFile(`${config.id}-game.json`), `${config.uses ?? ""}${config.source.commit}`);
        if (config.source.commit === "grown") writeFileSync(setFile(`${config.id}-extra.json`), "extra");
        return ok;
    };
    const passing = () => [["in-memory check", () => ok]];

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "refresh-attempt-"));
        setsDir = path.join(dir, "sets");
        mkdirSync(setsDir);
        writeFileSync(setFile("game-game.json"), "old");
        writeFileSync(setFile("other-game.json"), "old");
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const moveOf = (file) => ({ file, pins: [{ pinned: "old", to: "new" }] });

    it("keeps a move whose import and checks pass, and checks only the titles whose sets changed", () => {
        const game = configFile("game", { source: { commit: "old" } });
        const other = configFile("other", { source: { commit: "old" } });
        const checked = [];
        const checks = (file) => [["in-memory check", () => (checked.push(file), ok)]];
        const result = attempt([moveOf(game)], { files: [game, other], setsDir, importer, checks });
        expect([...result.changed.keys()]).toEqual([game]);
        expect(result.changed.get(game).names).toEqual(["game-game.json"]);
        expect(checked).toEqual([game]);
        expect(JSON.parse(read(game)).source.commit).toBe("new");
        expect(read(setFile("game-game.json"))).toBe("new");
    });

    it("puts the config and every set back when a check fails", () => {
        const game = configFile("game", { source: { commit: "old" } });
        const before = read(game);
        const move = { file: game, pins: [{ pinned: "old", to: "grown" }] };
        const checks = () => [["corpus check", () => failing("collides\nwith Frak")]];
        const result = attempt([move], { files: [game], setsDir, importer, checks });
        expect(result.failure).toEqual({ file: game, what: "corpus check", output: "collides\nwith Frak" });
        expect(read(game)).toBe(before);
        expect(read(setFile("game-game.json"))).toBe("old");
        expect(existsSync(setFile("game-extra.json"))).toBe(false);
    });

    it("puts everything back when an import fails", () => {
        const game = configFile("game", { source: { commit: "old" } });
        const before = read(game);
        const result = attempt([moveOf(game)], {
            files: [game],
            setsDir,
            importer: (file, config) => (importer(file, config), failing("no beebasm")),
            checks: passing,
        });
        expect(result.failure).toEqual({ file: game, what: "import", output: "no beebasm" });
        expect(read(game)).toBe(before);
        expect(read(setFile("game-game.json"))).toBe("old");
    });

    it("puts a system set's move back when another title fails its check against it", () => {
        const mos = configFile("mos", { system: true, source: { commit: "old" } });
        const other = configFile("other", { uses: "mos ", source: { commit: "old" } });
        const before = read(mos);
        const checks = (file) => [["in-memory check", () => (file === other ? failing("no match") : ok)]];
        const result = attempt([moveOf(mos)], { files: [mos, other], setsDir, importer, checks });
        expect(result.failure).toEqual({ file: other, what: "in-memory check", output: "no match" });
        expect(read(mos)).toBe(before);
        expect(read(setFile("other-game.json"))).toBe("old");
        expect(existsSync(setFile("mos-game.json"))).toBe(false);
    });

    it("gives what an importer throws as the failure", () => {
        const game = configFile("game", { source: { commit: "old" } });
        const importer = () => {
            throw new Error("game is for the nope importer, which isn't known");
        };
        const result = attempt([moveOf(game)], { files: [game], setsDir, importer, checks: passing });
        expect(result.failure).toEqual({ file: game, what: "refresh", output: expect.stringContaining("nope") });
    });

    it("remakes the other configs for a system set's move, the system set's first, and checks those that changed", () => {
        const mos = configFile("mos", { system: true, source: { commit: "old" } });
        const other = configFile("other", { uses: "mos ", source: { commit: "old" } });
        const order = [];
        const tracing = (file, config) => (order.push(path.basename(file)), importer(file, config));
        const checked = [];
        const checks = (file) => [["in-memory check", () => (checked.push(path.basename(file)), ok)]];
        const result = attempt([moveOf(mos)], { files: [other, mos], setsDir, importer: tracing, checks });
        expect(order).toEqual(["mos.json", "other.json"]);
        expect([...result.changed.keys()]).toEqual([mos, other]);
        expect(checked).toEqual(["mos.json", "other.json"]);
    });
});

describe("refreshMoves", () => {
    const title = (file, config = {}) => ({ file, config, pins: [] });
    const mos = title("mos.json", { system: true });
    const files = ["mos.json", "game.json", "hopper.json", "frak.json", "tom.json"];

    it("tries each title on its own, then the system sets over every config but a level7 one whose move failed", () => {
        const tried = [];
        const failing = ["hopper.json", "frak.json"];
        const tryMoves = (group, groupFiles) => {
            tried.push([group.map(({ file }) => file), groupFiles]);
            return failing.includes(group[0].file) ? { failure: { file: group[0].file } } : { changed: new Map() };
        };
        const moves = [mos, title("game.json"), title("hopper.json", { importer: "level7" }), title("frak.json")];
        const { kept, failed } = refreshMoves(moves, files, tryMoves);
        expect(tried).toEqual([
            [["game.json"], ["game.json"]],
            [["hopper.json"], ["hopper.json"]],
            [["frak.json"], ["frak.json"]],
            [["mos.json"], ["mos.json", "game.json", "frak.json", "tom.json"]],
        ]);
        expect(kept.map(({ moves, leftOut }) => [moves[0].file, leftOut])).toEqual([
            ["game.json", []],
            ["mos.json", ["hopper.json"]],
        ]);
        expect(failed.map(({ moves }) => moves[0].file)).toEqual(["hopper.json", "frak.json"]);
    });

    it("keeps the titles that moved when the system sets' move fails", () => {
        const tryMoves = (group) =>
            group[0].config.system ? { failure: { file: "game.json" } } : { changed: new Map() };
        const { kept, failed } = refreshMoves([title("game.json"), mos], files, tryMoves);
        expect(kept.map(({ moves }) => moves[0].file)).toEqual(["game.json"]);
        expect(failed.map(({ moves }) => moves[0].file)).toEqual(["mos.json"]);
    });
});

describe("exitCode", () => {
    it.each([
        [{ failed: [], refused: [], indexBuilt: true }, 0],
        [{ failed: [{}], refused: [], indexBuilt: true }, 1],
        [{ failed: [], refused: [{}], indexBuilt: true }, 1],
        [{ failed: [], refused: [], indexBuilt: false }, 1],
    ])("for %j is %i", (outcome, code) => {
        expect(exitCode(outcome)).toBe(code);
    });
});

describe("report", () => {
    const xmos = "/x/symbols/configs/xmos.json";
    const from = "469fe35d08012c986fc1a367247b8ee040151f13";
    const to = "73cf1883b3444b8a2043351805c203acaf2b8b30";
    const github = { repository: "https://github.com/mattgodbolt/xmos", pinned: from, to };

    it("says when the index wasn't built", () => {
        expect(report({ kept: [], failed: [], refused: [], indexBuilt: false })).toBe(
            "Building the index failed; the run's log says why.\n",
        );
    });

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
        ).toContain("The system sets' move also changed `kix.json`.");
    });

    it("names a pin shared by the source and py8dis once", () => {
        const changed = new Map();
        const pins = [github, { ...github }];
        const text = report({ kept: [{ moves: [{ file: xmos, pins }], changed }], failed: [], refused: [] });
        expect(text.match(/mattgodbolt\/xmos\]/g)).toHaveLength(1);
    });

    it("says which titles weren't remade against a system set's move", () => {
        const changed = new Map();
        const leftOut = ["/x/symbols/configs/hopper.json"];
        const text = report({
            kept: [{ moves: [{ file: xmos, pins: [github] }], changed, leftOut }],
            failed: [],
            refused: [],
        });
        expect(text).toContain("`hopper.json` weren't remade against the new system sets");
    });

    it("fences output with more backticks than it holds", () => {
        const hopper = "/x/symbols/configs/hopper.json";
        const failure = { file: hopper, what: "import", output: "a ```b``` c" };
        const text = report({ kept: [], failed: [{ moves: [{ file: hopper, pins: [] }], failure }], refused: [] });
        expect(text).toContain("  ````\n  a ```b``` c\n  ````");
    });

    it("leaves the outputs out of a report too long for a pull request", () => {
        const hopper = "/x/symbols/configs/hopper.json";
        const failure = { file: hopper, what: "import", output: "x".repeat(70000) };
        const text = report({ kept: [], failed: [{ moves: [{ file: hopper, pins: [] }], failure }], refused: [] });
        expect(text).not.toContain("xxx");
        expect(text).toContain("The run's log has each failure's output.");
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
