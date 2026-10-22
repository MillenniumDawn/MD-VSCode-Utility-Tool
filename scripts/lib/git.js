'use strict';

const { execFileSync } = require('child_process');

function git(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function tagExists(tag) {
	try {
		// --quiet keeps a missing tag from writing "Needed a single revision" to stderr; a miss is an
		// expected answer here, not a failure.
		git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
		return true;
	} catch {
		return false;
	}
}

module.exports = { git, tagExists };
