// Evaluates every built webview bundle the way a preview panel does, and fails on a
// ReferenceError.
//
// Why this exists: the tests compile webviewsrc with `module: commonjs`, where an exported `const`
// read before its declaration is a property access that answers `undefined`. Webpack emits ESM,
// where the same read is a real binding in its temporal dead zone and throws -- so an entry can
// abort before it registers a single listener while every test stays green. That is exactly how the
// idea, event, character and decision previews came to draw their toolbar over an empty canvas.
//
// The check is deliberately narrow. A bundle is loaded with nothing but `acquireVsCodeApi` and an
// empty i18n table, so the ones that read their payload global at module scope (focustree,
// miopreview) throw a TypeError here and always will; seeding a payload for each of them would be a
// fixture to maintain rather than a check. A ReferenceError is different: it never means "the host
// did not hand me my data", it means a binding is missing or unreachable, and no payload would
// change that.
//
// Run it after `npm run webpack` (or `npm run package`), which is what writes static/.

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const staticDir = path.resolve(__dirname, "..", "static");

// The shared chunk every preview's html loads before its own script. Not an entry itself.
const sharedChunk = "common.js";

function entryBundles() {
	return fs
		.readdirSync(staticDir)
		.filter((name) => name.endsWith(".js") && name !== sharedChunk)
		.sort();
}

function evaluate(name) {
	const dom = new JSDOM("<!DOCTYPE html><body></body>", {
		url: "https://localhost",
		pretendToBeVisual: true,
		runScripts: "outside-only",
	});
	const window = dom.window;
	window.acquireVsCodeApi = () => ({
		postMessage: () => undefined,
		getState: () => ({}),
		setState: () => undefined,
	});
	window.__i18ntable = {};

	try {
		window.eval(fs.readFileSync(path.join(staticDir, sharedChunk), "utf8"));
		window.eval(fs.readFileSync(path.join(staticDir, name), "utf8"));
		return undefined;
	} catch (e) {
		return e;
	} finally {
		window.close();
	}
}

function main() {
	if (!fs.existsSync(staticDir)) {
		console.error(
			`No ${staticDir}. Build the webview bundles first: npm run webpack`,
		);
		process.exit(1);
	}

	const bundles = entryBundles();
	if (bundles.length === 0) {
		console.error(`No entry bundles in ${staticDir}. Run: npm run webpack`);
		process.exit(1);
	}

	const failures = [];
	for (const name of bundles) {
		const thrown = evaluate(name);
		if (thrown instanceof ReferenceError) {
			failures.push([name, thrown]);
			console.log(`FAIL ${name}: ${thrown.message}`);
		} else if (thrown) {
			// Not a failure: the module wanted its payload, which this harness does not provide.
			console.log(`ok   ${name} (${thrown.name} after load, ignored)`);
		} else {
			console.log(`ok   ${name}`);
		}
	}

	if (failures.length > 0) {
		console.error(
			`\n${failures.length} webview bundle(s) threw a ReferenceError while evaluating. ` +
				`A preview built from one of these draws its toolbar and nothing else.`,
		);
		process.exit(1);
	}
}

main();
