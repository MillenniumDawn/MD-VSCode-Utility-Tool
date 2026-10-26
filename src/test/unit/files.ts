import * as fs from "fs";
import * as path from "path";

export function walkFiles(
	dir: string,
	accept: (file: string) => boolean,
	excludedDirectories: readonly string[] = [],
): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!excludedDirectories.includes(full)) {
				files.push(...walkFiles(full, accept, excludedDirectories));
			}
		} else if (accept(full)) {
			files.push(full);
		}
	}
	return files;
}
