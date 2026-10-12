import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { changedSets, importerScript, systemFirst } from "../../tools/symbols/reimport-all.js";

const ConfigsDir = new URL("../../symbols/configs/", import.meta.url);

describe("importerScript", () => {
    it.each([
        [{ importer: "acornaeology" }, "import-acornaeology.js"],
        [{ importer: "acme" }, "import-acme.js"],
        [{ importer: "level7" }, "import-level7.js"],
        [{ py8dis: {}, source: {} }, "import-py8dis.js"],
        [{ source: { assembler: "beebasm" } }, "import-beebasm.js"],
        [{ source: {} }, "import-baron.js"],
    ])("picks the importer for %j", (config, script) => {
        expect(importerScript(config)).toBe(script);
    });

    it("knows the importer of every config", () => {
        for (const name of readdirSync(ConfigsDir).filter((file) => file.endsWith(".json")))
            expect(() => importerScript(JSON.parse(readFileSync(new URL(name, ConfigsDir), "utf8")))).not.toThrow();
    });

    it("refuses an importer it doesn't know", () => {
        expect(() => importerScript({ id: "odd", importer: "nope" })).toThrow("nope");
    });
});

describe("systemFirst", () => {
    it("puts the system sets' configs first, keeping the order within each group", () => {
        const configs = [
            { file: "a.json", config: {} },
            { file: "mos.json", config: { system: true } },
            { file: "b.json", config: {} },
        ];
        expect(systemFirst(configs).map(({ file }) => file)).toEqual(["mos.json", "a.json", "b.json"]);
    });
});

describe("changedSets", () => {
    it("lists the files added, removed and changed", () => {
        const before = new Map([
            ["a.json", "1"],
            ["b.json", "2"],
            ["c.json", "3"],
        ]);
        const after = new Map([
            ["a.json", "1"],
            ["b.json", "two"],
            ["d.json", "4"],
        ]);
        expect(changedSets(before, after)).toEqual(["b.json", "c.json", "d.json"]);
    });
});
