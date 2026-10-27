'use strict';

// Stdout is reserved for results (including JSON or GITHUB_OUTPUT); Actions reads workflow commands from stderr too.

function escapeData(value) {
	return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value) {
	return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function warn(message, { file, line } = {}) {
	const location = file === undefined ? '' : ` file=${escapeProperty(file)},line=${escapeProperty(line)}`;
	process.stderr.write(`::warning${location}::${escapeData(message)}\n`);
}

function notice(message) {
	process.stderr.write(`::notice::${escapeData(message)}\n`);
}

module.exports = { warn, notice };
