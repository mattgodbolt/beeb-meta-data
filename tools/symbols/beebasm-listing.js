/**
 * Reads what one beebasm run (`beebasm -v -dd -labels FILE`) says about a build: its verbose listing and
 * its label dump.
 *
 * The listing has a line for each instruction (its address, all its bytes, then the instruction with its
 * operand already a number), each EQUB, EQUW and EQUD value (its address and bytes), each EQUS and INCBIN
 * (its address and at most three bytes, then `...`), each SKIP (its address alone), each label (`.name`,
 * with no scope and no address), each macro's call (`Macro NAME:` ... `End macro NAME`), and each SAVE
 * (`Saving file 'NAME'`). SKIPTO, ALIGN, ORG, CLEAR, `=` and braces leave no line, and PRINT's output
 * appears wherever it ran.
 *
 * The label dump is a Python literal, `[{'.name':address L,...}]`, of every label in the order the
 * listing shows them, qualified with beebasm's scopes: a label just before a `{` names it, and a scope
 * with no label of its own, a FOR loop's pass or a macro's call is `_N` or `_var_value`.
 */

const StatementLine = /^ {5}([0-9A-F]{4})(?: {3}(.*))?$/;
const InstructionText = /^((?:[0-9A-F]{2} ){1,3}) *([A-Z]{3})(?: (.*))?$/;
const DataText = /^((?:[0-9A-F]{2} ?)*)(\.\.\.)?\s*(INCBIN\b.*)?$/;
const LabelLine = /^\.([A-Za-z_]\w*)$/;
const SaveLine = /^Saving file '(.*)'$/;
const MacroStartLine = /^Macro \w+:$/;
const MacroEndLine = /^End macro \w+$/;
const DumpEntry = /'([^']*)':(-?\d+)L/g;
const MemoryOperand = /^\(?&([0-9A-F]{1,4})\b/;
const BranchMnemonics = new Set(["BCC", "BCS", "BEQ", "BMI", "BNE", "BPL", "BVC", "BVS", "BRA"]);
const Separator = ".";
export const UnnamedScope = "{}";

/**
 * @typedef {object} ListedStatement
 * @property {number} order - its line in the listing
 * @property {number} address
 * @property {number[]} bytes - those the listing shows
 * @property {boolean} code - an instruction
 * @property {string | null} mnemonic
 * @property {number | null} target - for an instruction that reads or writes memory, the address it names
 * @property {boolean} truncated - an EQUS or INCBIN, whose bytes the listing cuts at three
 * @property {boolean} skip - a SKIP, whose bytes the listing doesn't show
 *
 * @typedef {{order: number, name: string, inMacro: boolean}} ListedLabel - `inMacro` for one a macro's call made
 * @typedef {{order: number, file: string}} ListedSave
 */

/** The address an instruction's operand names, if it names one: not an immediate, a branch or `A`. */
export function memoryOperand(mnemonic, operand) {
    if (BranchMnemonics.has(mnemonic)) return null;
    const digits = MemoryOperand.exec(operand ?? "")?.[1];
    return digits === undefined ? null : parseInt(digits, 16);
}

/**
 * @param {string} text - the listing, beebasm's standard output
 * @param {string} printPrefix - what starts a line the importer's own PRINTs wrote, `PREFIX:name:value`
 * @returns {{statements: ListedStatement[], labels: ListedLabel[], saves: ListedSave[],
 *     printed: Map<string, string>}} `printed` maps each name the importer's PRINTs gave to its value as text
 */
export function parseBeebasmListing(text, printPrefix) {
    const statements = [];
    const labels = [];
    const saves = [];
    const printed = new Map();
    let macroDepth = 0;
    text.split(/\r\n|\r|\n/).forEach((line, order) => {
        if (MacroStartLine.test(line)) macroDepth++;
        else if (MacroEndLine.test(line)) macroDepth--;
        if (line.startsWith(`${printPrefix}:`)) {
            const [name, ...value] = line.slice(printPrefix.length + 1).split(":");
            printed.set(name, value.join(":").trim());
            return;
        }
        const label = LabelLine.exec(line);
        if (label) {
            labels.push({ order, name: label[1], inMacro: macroDepth > 0 });
            return;
        }
        const save = SaveLine.exec(line);
        if (save) {
            saves.push({ order, file: save[1] });
            return;
        }
        const listed = StatementLine.exec(line);
        if (!listed) return;
        const address = parseInt(listed[1], 16);
        const rest = listed[2];
        const statement = { order, address, bytes: [], code: false, mnemonic: null, target: null };
        if (rest === undefined) {
            statements.push({ ...statement, truncated: false, skip: true });
            return;
        }
        const instruction = InstructionText.exec(rest);
        if (instruction) {
            const mnemonic = instruction[2];
            statements.push({
                ...statement,
                bytes: hexBytes(instruction[1]),
                code: true,
                mnemonic,
                target: memoryOperand(mnemonic, instruction[3]),
                truncated: false,
                skip: false,
            });
            return;
        }
        const data = DataText.exec(rest);
        if (!data) return;
        statements.push({
            ...statement,
            bytes: hexBytes(data[1]),
            truncated: data[2] !== undefined || data[3] !== undefined,
            skip: false,
        });
    });
    return { statements, labels, saves, printed };
}

const hexBytes = (text) =>
    text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((field) => parseInt(field, 16));

/** @returns {{identifier: string, address: number}[]} the dump's labels, in its order */
export function parseLabelDump(text) {
    return [...text.matchAll(DumpEntry)].map(([, identifier, address]) => ({
        identifier,
        address: parseInt(address, 10),
    }));
}

/**
 * A dumped label's name, its scopes joined with `.`, whether it's inside a scope beebasm made up (a brace
 * with no label, a FOR loop's pass or a macro's call), however far out: one whose own identifier no label
 * has, and how the source qualifies it (`written`, as definitionsIn does). A label the source
 * exported (`.*name`, in `exported` as it's written) is named alone, at the top level, as the source uses
 * it, and a made-up scope `scopeNames` names takes that name.
 * @param {Set<string>} labelled - every identifier the dump holds
 * @param {Set<string>} [exported]
 * @param {Map<string, string>} [scopeNames] - see exportedScopeNames
 */
export function labelName(identifier, labelled, exported = new Set(), scopeNames = new Map()) {
    const parts = identifier.split(Separator).filter(Boolean);
    const scopes = parts.slice(0, -1).map((_, i) => `${Separator}${parts.slice(0, i + 1).join(Separator)}`);
    const made = scopes.map((scope) => !labelled.has(scope));
    const plain = parts.map((part, i) => (made[i] ? UnnamedScope : part)).join(Separator);
    if (exported.has(plain)) return { name: parts.at(-1), scope: [], internal: false, written: plain };
    const named = parts.map((part, i) => (made[i] ? (scopeNames.get(scopes[i]) ?? part) : part));
    const written = named.map((part, i) => (made[i] && !scopeNames.has(scopes[i]) ? UnnamedScope : part));
    return {
        name: named.join(Separator),
        scope: named.slice(0, -1),
        internal: made.some((isMade, i) => isMade && !scopeNames.has(scopes[i])),
        written: written.join(Separator),
    };
}

/**
 * Names for the braces with no label whose first label the source exported, `{ .*routine ... }`, as a
 * routine with private labels is often written: each such scope's identifier, to its exported label.
 * @param {string[]} identifiers - the dump's, in its order
 * @param {Set<string>} labelled
 * @param {Set<string>} exported
 */
export function exportedScopeNames(identifiers, labelled, exported) {
    const first = new Map();
    for (const identifier of identifiers) {
        const scope = identifier.slice(0, identifier.lastIndexOf(Separator));
        if (scope && !labelled.has(scope) && !first.has(scope)) first.set(scope, identifier);
    }
    const out = new Map();
    for (const [scope, identifier] of first) {
        const { name, scope: inside } = labelName(identifier, labelled, exported);
        if (!inside.length && identifier !== `${Separator}${name}`) out.set(scope, name);
    }
    return out;
}
