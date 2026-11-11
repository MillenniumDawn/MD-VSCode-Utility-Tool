'use strict';

const path = require('path');

function restoreDependencyPaths(cwd, directories) {
	const redacted = cwd.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '***');
	if (redacted === cwd) {
		return directories;
	}
	return directories.map(directory => directory === redacted || directory.startsWith(redacted + path.sep)
		? cwd + directory.slice(redacted.length)
		: directory);
}

if (require.main === module) {
	const npm = require('@vscode/vsce/out/npm');
	const getDependencies = npm.getDependencies;
	// npm redacts UUIDs even in parseable output; restore only the known checkout prefix.
	npm.getDependencies = async (cwd, ...args) => restoreDependencyPaths(cwd, await getDependencies(cwd, ...args));
	require('@vscode/vsce/out/main')([
		process.execPath,
		require.resolve('@vscode/vsce/vsce'),
		'package',
		...process.argv.slice(2),
	]);
}

module.exports = { restoreDependencyPaths };
