import * as path from "path";
import Mocha from "mocha";

export async function run(): Promise<void> {
	const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20000 });
	mocha.addFile(path.resolve(__dirname, "../activation.suite.js"));

	return new Promise((resolve, reject) => {
		mocha.run((failures: number) => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`));
			} else {
				resolve();
			}
		});
	});
}
