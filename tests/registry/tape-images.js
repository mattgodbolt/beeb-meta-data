// UEF tape images built block by block, for the tests that decode or boot one.
import { tapeCrc } from "../../tools/registry/tape.js";

const MaxBlockLength = 256;
export const LastBlock = 0x80;

export const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
export const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const be16 = (v) => [(v >> 8) & 0xff, v & 0xff];

export function block({ name, load = 0xffff1900, exec = 0xffff8023, number, flags = 0, data, badDataCrc = false }) {
    const header = [...name].map((c) => c.charCodeAt(0));
    header.push(0, ...le32(load), ...le32(exec), ...le16(number), ...le16(data.length), flags, 0, 0, 0, 0);
    const bytes = [0x2a, ...header, ...be16(tapeCrc(Uint8Array.from(header)))];
    if (data.length) bytes.push(...data, ...be16(tapeCrc(Uint8Array.from(data)) ^ (badDataCrc ? 1 : 0)));
    return bytes;
}

export function fileBlocks(name, data, { load, exec, flags = 0 } = {}) {
    const blocks = [];
    for (let number = 0, pos = 0; number === 0 || pos < data.length; ++number, pos += MaxBlockLength) {
        const chunk = data.slice(pos, pos + MaxBlockLength);
        const last = pos + MaxBlockLength >= data.length;
        blocks.push(block({ name, load, exec, number, flags: flags | (last ? LastBlock : 0), data: chunk }));
    }
    return blocks;
}

export function uef(chunks) {
    const out = [..."UEF File!"].map((c) => c.charCodeAt(0));
    out.push(0, 10, 0);
    for (const [id, body] of chunks) out.push(...le16(id), ...le32(body.length), ...body);
    return Uint8Array.from(out);
}

export const carrier = (cycles) => [0x0110, le16(cycles)];
export const data = (bytes) => [0x0100, bytes];

// One block per data chunk, each after a carrier, as most UEF writers lay a tape out.
export const plainUef = (blocks) => uef(blocks.flatMap((b) => [carrier(600), data(b)]));

// Where CHAIN"" puts a program on a B with DFS 1.2, and on a Master.
export const BasicPage = 0x1900;
export const MasterBasicPage = 0x0e00;
const CyclesPerSecond = 2000000;
const TapeLoadSecs = 20;
export const TapeLoadCycles = TapeLoadSecs * CyclesPerSecond;

/** Line 10 of a BBC BASIC program, `text`, as it sits in memory; `text` must hold no keywords, which aren't tokenised. */
export function basicLine(text) {
    const bytes = [...Buffer.from(text, "latin1")];
    return [0x0d, 0x00, 0x0a, bytes.length + 4, ...bytes, 0x0d, 0xff];
}

/** A tape holding that program, as SAVE writes it. */
export const basicTape = (text) =>
    plainUef(fileBlocks("PROG", basicLine(text), { load: 0xffff0000 + BasicPage, exec: 0xffff8023 }));
