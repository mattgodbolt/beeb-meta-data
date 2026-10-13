import { describe, expect, it } from "vitest";

import { publishedUrl } from "../../tools/registry/mirrors.js";

describe("mirrors", () => {
    it("publishes a corpus path at its mirror's URL, and gives none for any other path", () => {
        expect(publishedUrl("sth-disc/AnF/Chuckie Egg.zip")).toBe(
            "https://bbc.xania.org/archive/sth/diskimages/AnF/Chuckie%20Egg.zip",
        );
        expect(publishedUrl("sth-tape/Robico/Hunt.zip")).toBe(
            "https://bbc.xania.org/archive/sth/tapeimages/Robico/Hunt.zip",
        );
        expect(publishedUrl("hfe/Acornsoft/Elite.hfe")).toBe(
            "https://bbc.xania.org/archive/bbcdiscs/hfe/Acornsoft/Elite.hfe",
        );
        expect(publishedUrl("chuckie-egg-2.ssd")).toBeNull();
        expect(publishedUrl("constructor/x.zip")).toBeNull();
    });
});
