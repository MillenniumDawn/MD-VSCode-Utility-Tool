'use strict';

const childProcess = require('child_process');

function gh(args) {
	return childProcess.execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

module.exports = { gh };
