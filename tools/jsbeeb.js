import path from "node:path";
import { fileURLToPath } from "node:url";

export const JsbeebDir = fileURLToPath(new URL("..", import.meta.resolve("jsbeeb/src/symbol-sets.js")));
export const RomsDir = path.join(JsbeebDir, "public/roms");
