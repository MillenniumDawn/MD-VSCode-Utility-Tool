// Resolves and starts the native TypeScript compiler, and is the only place that decides how.
//
// Why this exists: `typescript` in node_modules is the alias for @typescript/typescript6 -- the
// JavaScript API ts-loader and typescript-eslint load, whose CLI is `tsc6` -- while the compiler
// that type-checks the build is the native TypeScript 7 behind the `@typescript/native` alias. Its
// entry point is read from that package's own `bin` field after install rather than guessed: where
// the compiler lives is the package's business, not a path to hard-code here or in the workflows.
//
// TypeScript 7's tsc is a native executable, but the advertised entry point may be a JavaScript
// shim that launches it. Only an entry point verified to be such a shim runs under node; anything
// else is started as the executable it is. Either way it goes over an argument vector with no
// shell, so nothing here depends on `tsc.cmd` or `shell: true` on Windows.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

// The installed entry point of the native compiler, from the bin field of the alias package.
function nativeTscBin() {
	const packageDir = path.join(repoRoot, "node_modules", "@typescript", "native");
	const manifest = JSON.parse(
		fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
	);
	const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.tsc;
	if (typeof bin !== "string" || bin.trim() === "") {
		throw new Error("@typescript/native installs no tsc bin entry to run");
	}
	return path.join(packageDir, bin);
}

// A shebang naming node, or a .js-family extension, means node must run the file; anything else is
// the native executable itself. This is the verification that makes `process.execPath` below safe.
function isJavaScriptShim(file) {
	const extension = path.extname(file).toLowerCase();
	if (extension === ".js" || extension === ".cjs" || extension === ".mjs") {
		return true;
	}
	const descriptor = fs.openSync(file, "r");
	const head = Buffer.alloc(256);
	const bytes = fs.readSync(descriptor, head, 0, head.length, 0);
	fs.closeSync(descriptor);
	return /^#![^\n]*\bnode\b/.test(head.toString("utf8", 0, bytes));
}

// The command that starts the native compiler, with the arguments it needs in front of the
// caller's own. Every type-check in the repository -- the test projects, the workflows, the
// webpack diagnostic test -- runs this one binary.
function nativeTscCommand() {
	const bin = nativeTscBin();
	return isJavaScriptShim(bin)
		? { command: process.execPath, args: [bin] }
		: { command: bin, args: [] };
}

if (require.main === module) {
	const { command, args } = nativeTscCommand();
	const child = spawn(command, [...args, ...process.argv.slice(2)], {
		stdio: "inherit",
	});
	child.on("error", (error) => {
		process.stderr.write(`${error.message}\n`);
		process.exit(1);
	});
	child.on("close", (code) => {
		process.exit(code === null ? 1 : code);
	});
}

module.exports = { nativeTscCommand };
