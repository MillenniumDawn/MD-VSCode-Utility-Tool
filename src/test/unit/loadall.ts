// Run as a script by loads.test.ts, in a process of its own: loads every compiled source module
// and prints, as JSON, the ones that could not load and why. No editor is handed over, so a module
// that imports `vscode`, or reaches for host() while it is still loading, shows up here.
import * as path from "path";
import { walkFiles } from "./files";

// out-test/src, from out-test/src/test/unit.
const root = path.resolve(__dirname, "../..");

const failed: Record<string, string> = {};
for (const file of walkFiles(root, file => file.endsWith(".js"), [path.join(root, "test")]).sort()) {
	try {
		require(file);
	} catch (error) {
		failed[path.relative(root, file).replace(/\\/g, "/")] = String((error as Error).message).split("\n")[0];
	}
}
process.stdout.write(JSON.stringify(failed));
