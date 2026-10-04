import Mocha from "mocha";
import * as path from "path";

export async function run(): Promise<void> {
	const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30000 });
	mocha.addFile(path.resolve(__dirname, "extension.suite.js"));
	return new Promise((resolve, reject) => {
		mocha.run((failures: number) => {
			if (failures > 0) {
				reject(new Error(`${failures} web extension smoke test(s) failed.`));
			} else {
				resolve();
			}
		});
	});
}
