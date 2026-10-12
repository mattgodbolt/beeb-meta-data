/**
 * Reads one of the disassemblies at https://www.level7.org.uk/miscellany/, plain text in which each
 * statement is a line of its address, its bytes and, for an instruction, the instruction (`&1400 a9 13
 * LDA #&13`), each label is a line of its own (`; entry_point`) before the statement it names, and an
 * instruction's operand is often followed by the name of what it addresses (`STA &8f ;
 * code_address_high`). A heading (`Game disassembly`, underlined with `=`) or a file's header
 * (`; HOPPER` then `; ff0e00 ff8023 000800`, its load, exec and length) starts a new part.
 */

const Statement = /^&([0-9a-f]{4})((?: [0-9a-f]{2})+)(?= |$)(.*)$/i;
const LabelLine = /^; ([A-Za-z_][\w.]*)\s*(?:\(.*\))?\s*(?:#.*)?$/;
const FileHeader = /^; ([0-9a-f]{6,8}) ([0-9a-f]{6,8}) ([0-9a-f]{4,8})(?:\s|$)/i;
const Underline = /^=+$/;
const ModifiedNote = /^#\s+(?:actually|or)\s/;
const Instruction = /^ *([A-Z]{3})(?: +([^;]*?))?\s*(?:;\s*(.*))?$/;
const HashComment = /\s#(?:\s.*)?$/;
const Identifier = /^[A-Za-z_][\w.]*$/;
const OperandAddress = /^(\()?&([0-9a-f]{2,4})\b/i;
const Branches = new Set(["BCC", "BCS", "BEQ", "BMI", "BNE", "BPL", "BVC", "BVS", "BRA"]);
const OperandStart = /^[#&(]/;

/** How many bytes an instruction takes, from how its operand is written. */
export function instructionLength(mnemonic, operand) {
    if (!OperandStart.test(operand) && !Branches.has(mnemonic)) return 1;
    if (Branches.has(mnemonic) || operand.startsWith("#")) return 2;
    const digits = /&([0-9a-f]+)/i.exec(operand)?.[1];
    if (digits === undefined) return undefined;
    if (operand.startsWith("(") && mnemonic !== "JMP") return 2;
    return digits.length <= 2 ? 2 : 3;
}

const stripHashComment = (text) => text.replace(HashComment, "").trim();

/**
 * @typedef {object} Level7Statement
 * @property {number} address
 * @property {number[]} data
 * @property {boolean} code
 * @property {boolean} skip - always false; the format has no padding
 * @property {object} section - its part
 * @property {number | undefined} base - an instruction's operand
 * @property {number} line - 1-based
 * @property {boolean} modified - the disassembly says it runs as something else (`# actually ...`)
 *
 * @typedef {object} Level7Part
 * @property {string} name - its file's name, else its heading
 * @property {string} heading
 * @property {{name: string, load: number, exec: number, length: number} | null} file
 * @property {Level7Statement[]} statements
 * @property {{name: string, address: number, line: number}[]} labels
 */

/**
 * The disassembly's parts, each with its statements and labels, and every name an operand is given.
 * @returns {{parts: Level7Part[], references: {name: string, address: number, line: number, statement: Level7Statement}[],
 *     doubtful: string[]}} doubtful is the instructions whose bytes their operand disagrees with, read as data
 */
export function readLevel7(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const parts = [];
    const references = [];
    const doubtful = [];
    let heading = "";
    let part = null;
    let pending = [];
    let previous = null;
    const startPart = (name, file) => {
        part = { name, heading, file, statements: [], labels: [] };
        parts.push(part);
        pending = [];
        previous = null;
    };
    lines.forEach((text, i) => {
        const line = i + 1;
        if (Underline.test(text) && i > 0 && lines[i - 1].trim().length === text.length) {
            heading = lines[i - 1].trim();
            part = null;
            pending = [];
            previous = null;
            return;
        }
        const header = FileHeader.exec(text);
        if (header) {
            const name = stripHashComment(/^; (.*)$/.exec(lines[i - 1] ?? "")?.[1] ?? "");
            const [load, exec, length] = header.slice(1).map((digits) => parseInt(digits, 16));
            startPart(name || heading, { name, load, exec, length });
            return;
        }
        if (FileHeader.test(lines[i + 1] ?? "")) return;
        if (ModifiedNote.test(text)) {
            if (previous) previous.modified = true;
            return;
        }
        const label = LabelLine.exec(text);
        if (label) {
            pending.push({ name: label[1], line });
            return;
        }
        const statement = Statement.exec(text);
        if (!statement) return;
        if (!part) startPart(heading, null);
        const address = parseInt(statement[1], 16);
        const data = statement[2]
            .trim()
            .split(" ")
            .map((byte) => parseInt(byte, 16));
        const rest = statement[3];
        const instruction = Instruction.exec(stripHashComment(rest));
        const read = { address, data, code: false, skip: false, section: part, base: undefined, line, modified: false };
        if (instruction && !rest.trimStart().startsWith(";")) {
            const [, mnemonic, operand = "", comment] = instruction;
            const length = instructionLength(mnemonic, operand.trim());
            if (length !== data.length) {
                doubtful.push(
                    `line ${line}: ${mnemonic} ${operand} is ${length ?? "an unknown number of"} bytes, not ${data.length}`,
                );
            } else {
                read.code = true;
                const target = OperandAddress.exec(operand.trim());
                if (target && !operand.trim().startsWith("#")) {
                    read.base = parseInt(target[2], 16);
                    const name = comment === undefined ? undefined : stripHashComment(comment);
                    if (name && Identifier.test(name) && !Branches.has(mnemonic))
                        references.push({ name, address: read.base, line, statement: read });
                }
            }
        }
        for (const { name, line: labelLine } of pending) part.labels.push({ name, address, line: labelLine });
        pending = [];
        part.statements.push(read);
        previous = read;
    });
    return { parts, references, doubtful };
}
