/**
 * symbols/titles.md, the list of titles with sets, made from the configs and the sets they made. build-index.js
 * writes it beside the index.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const TitlesFile = "titles.md";
const RomStart = 0x8000;
const RomEnd = 0xc000;

const Kinds = [
    ["program", "Programs"],
    ["rom", "Sideways ROMs"],
    ["system", "Operating systems"],
];

/** Every curator config under `dir`, by its file name. */
export const readConfigs = (dir) =>
    readdirSync(path.join(dir, "configs"))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => ({ name, config: JSON.parse(readFileSync(path.join(dir, "configs", name), "utf8")) }));

/** The set files a config makes, as `readSets` names them. */
export const setFilesOf = (config) =>
    config.sets.map((spec) => `sets/${config.id === undefined ? spec.id : `${config.id}-${spec.id}`}.json`);

/** What a title's sets name: a MOS, a sideways ROM (some region in &8000-&BFFF), or a program. */
export function kindOf(sets) {
    if (sets.some((json) => json.system)) return "system";
    const regions = sets.flatMap((json) => Object.values(json.regions));
    const inRom = ({ start, end }) => parseInt(start, 16) >= RomStart && parseInt(end, 16) <= RomEnd;
    return regions.some(inRom) ? "rom" : "program";
}

const escape = (text) => text.replace(/[\\[\]*_`<~]/g, "\\$&").replace(/&/g, "&amp;");
const licenceName = (licence) => licence.replace(/^LicenseRef-/, "");
const link = (url) => `[${escape(shortUrl(url))}](<${url}>)`;
const shortUrl = (url) => {
    const { hostname, pathname } = new URL(url);
    const [owner, repo] = pathname.split("/").filter(Boolean);
    return hostname === "github.com" && repo ? `${owner}/${repo}` : hostname.replace(/^www\./, "");
};

/**
 * One row per config: its name, its licence, and where its names come from, or for a config with several sets,
 * each set's title and where its names come from. A config's sets have to share a licence.
 */
export function titleRows(configs, setsByFile) {
    return configs.map(({ name, config }) => {
        const sets = setFilesOf(config).map((file) => {
            const json = setsByFile.get(file);
            if (!json) throw new Error(`${name} makes ${file}, which isn't in symbols/sets`);
            return json;
        });
        if (sets.length > 1 && !config.name)
            throw new Error(`${name} makes ${sets.length} sets, so it needs a name for the titles list`);
        const licences = new Set(sets.map((json) => json.licence));
        if (licences.size > 1) throw new Error(`${name}'s sets have different licences: ${[...licences].join(", ")}`);
        const links = sets.map((json) => ({ title: json.title, from: json.home ?? json.source }));
        return {
            kind: kindOf(sets),
            title: config.name ?? sets[0].title,
            licence: sets[0].licence,
            ...(sets.length > 1 ? { covers: links } : { from: links[0].from }),
        };
    });
}

/** The Markdown of symbols/titles.md. */
export function titlesMarkdown(rows) {
    const sections = Kinds.map(([kind, heading]) => {
        const these = rows
            .filter((row) => row.kind === kind)
            .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
        if (!these.length) return [];
        return [
            `## ${heading}`,
            "",
            ...these.flatMap(({ title, covers, from, licence }) => {
                const licenceText = `(${escape(licenceName(licence))})`;
                if (!covers) return [`- **${escape(title)}**, names from ${link(from)} ${licenceText}`];
                return [
                    `- **${escape(title)}** ${licenceText}`,
                    ...covers.map((cover) => `  - ${escape(cover.title)}, names from ${link(cover.from)}`),
                ];
            }),
            "",
        ];
    });
    return [
        "# Titles with symbol sets",
        "",
        "The programs, ROMs and operating systems whose code jsbeeb's debugger can name from these sets.",
        "`npm run build-index` makes this list from `symbols/configs/` and `symbols/sets/`, so don't edit it by hand.",
        "",
        ...sections.flat(),
    ].join("\n");
}
