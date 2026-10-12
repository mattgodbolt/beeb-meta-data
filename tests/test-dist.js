import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeDist } from "../tools/dist.js";

describe("dist", () => {
    let dir;
    const symbols = () => path.join(dir, "symbols");
    const out = () => path.join(dir, "dist");
    const write = (file, json) => {
        mkdirSync(path.dirname(path.join(symbols(), file)), { recursive: true });
        writeFileSync(path.join(symbols(), file), JSON.stringify(json));
    };

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "dist-"));
        write("index.json", { format: 1, sets: [{ url: "sets/game.json", regions: {} }] });
        write("sets/game.json", { format: 1, title: "Game" });
        write("sets/unlisted.json", { format: 1, title: "Unlisted" });
        write("mos-sets.json", ["sets/game.json"]);
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("copies the index and the sets it lists under meta/symbols, and nothing else", () => {
        expect(writeDist(symbols(), out())).toEqual(["meta/symbols/index.json", "meta/symbols/sets/game.json"]);
        expect(readdirSync(path.join(out(), "meta/symbols"))).toEqual(["index.json", "sets"]);
        expect(readdirSync(path.join(out(), "meta/symbols/sets"))).toEqual(["game.json"]);
        expect(JSON.parse(readFileSync(path.join(out(), "meta/symbols/sets/game.json"), "utf8")).title).toBe("Game");
    });

    it("starts from an empty output, so a set dropped from the index isn't left behind", () => {
        writeDist(symbols(), out());
        write("index.json", { format: 1, sets: [] });
        writeDist(symbols(), out());
        expect(readdirSync(path.join(out(), "meta/symbols"))).toEqual(["index.json"]);
    });
});
