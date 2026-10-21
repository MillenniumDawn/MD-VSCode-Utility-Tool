// What has to be in place before any source module loads in the unit tests. Mocha requires this
// file first. It stands in for the build and keeps the output quiet; it is not a stand-in for the
// editor, which a test hands over itself when the code under test needs one (see ./host).
import { registerHooks } from "module";

// The one constant webpack defines at build time that modules read as they load.
(globalThis as { IS_WEB_EXT?: boolean }).IS_WEB_EXT = false;

// Silences debug() for the whole run; see src/util/debug.ts.
process.env.MD_UTILITIES_TEST = "1";

// webpack inlines *.html and *.css as strings; tsc does not copy them into out-test. An empty
// string is enough for the modules that import one to finish loading.
const asset = "file:///asset.js";
registerHooks({
	resolve: (specifier, context, nextResolve) =>
		/\.(css|html)$/.test(specifier)
			? { url: asset, format: "commonjs", shortCircuit: true }
			: nextResolve(specifier, context),
	load: (url, context, nextLoad) =>
		url === asset
			? { format: "commonjs", source: "module.exports = { __esModule: true, default: '' };", shortCircuit: true }
			: nextLoad(url, context),
});
