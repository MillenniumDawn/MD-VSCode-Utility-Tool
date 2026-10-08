'use strict';

function parseFlags(argv, spec, { defaults = {}, strict = false } = {}) {
	const options = { ...defaults };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const flag = Object.hasOwn(spec, arg) ? spec[arg] : undefined;
		if (flag && typeof flag === 'object' && Object.hasOwn(flag, 'value')) {
			options[flag.name] = flag.value;
			continue;
		}
		const value = argv[i + 1];
		if (strict && value === undefined) {
			throw new Error(`Missing value for ${arg}`);
		}
		if (!flag) {
			if (strict) {
				throw new Error(`Unknown option ${arg}`);
			}
			continue;
		}
		const name = typeof flag === 'string' ? flag : flag.name;
		options[name] = flag.parse ? flag.parse(value, options) : value;
		i++;
	}
	return options;
}

module.exports = { parseFlags };
