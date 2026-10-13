/** Where each of the corpus's mirrors is published, by the directory fetch-corpus.js puts its copy in. */
export const Mirrors = {
    "sth-disc": "https://bbc.xania.org/archive/sth/diskimages/",
    "sth-tape": "https://bbc.xania.org/archive/sth/tapeimages/",
    hfe: "https://bbc.xania.org/archive/bbcdiscs/hfe/",
};

/** The URL of the published copy of the corpus file at `ref` (`sth-disc/<path>`, say), or null if it's in no mirror. */
export function publishedUrl(ref) {
    const [mirror, ...rest] = ref.split("/");
    return Object.hasOwn(Mirrors, mirror) && rest.length
        ? Mirrors[mirror] + rest.map(encodeURIComponent).join("/")
        : null;
}
