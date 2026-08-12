// @ts-nocheck
import * as path from "path";
import Mocha from "mocha";

export async function run(): Promise<void> {
	const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20000 });
	const testsRoot = path.resolve(__dirname, ".");
	mocha.addFile(path.resolve(testsRoot, "extension.suite.js"));

	return new Promise((resolve, reject) => {
		try {
			mocha.run((failures: number) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			reject(err);
		}
	});
}
