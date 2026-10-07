'use strict';

// Stdout is reserved for results (including JSON or GITHUB_OUTPUT); Actions reads workflow commands from stderr too.

function warn(message, { file, line } = {}) {
	const location = file === undefined ? '' : ` file=${file},line=${line}`;
	process.stderr.write(`::warning${location}::${message}\n`);
}

function notice(message) {
	process.stderr.write(`::notice::${message}\n`);
}

module.exports = { warn, notice };
