import * as assert from "assert";
import { execFile } from "child_process";
import { promisify } from "util";
import {
	Node,
	NodeValue,
	Token,
	parseHoi4File,
	resolveScriptVariables,
} from "../../../hoiformat/hoiparser";
import { UserError } from "../../../util/common";
import { children, parse } from "../hoi";

const sym = (name: string) => ({ name });

// A node without its positions: [name, operator, value], a block as nested shapes, and the
// attachment last when there is one.
function shape(node: Node): unknown[] {
	const value = Array.isArray(node.value) ? node.value.map(shape) : node.value;
	const result = [node.name, node.operator, value];
	return node.valueAttachment ? [...result, node.valueAttachment.name] : result;
}

function shapes(source: string): unknown[][] {
	return children(source).map(shape);
}

function walk(node: Node, visit: (node: Node) => void): void {
	visit(node);
	if (Array.isArray(node.value)) {
		node.value.forEach((child) => walk(child, visit));
	}
}

function tokensOf(node: Node): (Token | null)[] {
	return [
		node.nameToken,
		node.operatorToken,
		node.valueStartToken,
		node.valueEndToken,
		node.valueAttachmentToken,
	];
}

describe("hoiformat/hoiparser", () => {
	it("rejects an unterminated escaped string without blocking the caller", async function () {
		this.timeout(5000);
		// Mocha cannot interrupt a synchronous regex; the parent must be able to kill the parser.
		const { stdout } = await promisify(execFile)(process.execPath, ["-e", `
			const { parseHoi4File } = require(process.argv[1]);
			try {
				parseHoi4File('a = "' + '\\\\'.repeat(120));
				process.exitCode = 1;
			} catch (e) {
				if (e.name !== 'UserError' || !e.message.includes('Invalid token')) {
					throw e;
				}
				process.stdout.write(e.name);
			}
		`, require.resolve("../../../hoiformat/hoiparser")], {
			timeout: 3000,
			killSignal: "SIGKILL",
		});
		assert.strictEqual(stdout, "UserError");
	});

	describe("a value", () => {
		const values: [string, NodeValue][] = [
			["1", 1],
			["-3", -3],
			["0.25", 0.25],
			[".5", 0.5],
			["-.5", -0.5],
			// Millennium Dawn writes `nationalist_drift = 0.` in its leader traits.
			["0.", 0],
			["2030.1", 2030.1],
			["0xff", 255],
			["0xffffffff", 4294967295],
			['"text"', "text"],
			['""', ""],
			['"say \\"hi\\""', 'say "hi"'],
			['"C:\\\\mods"', "C:\\mods"],
			['"C:\\mods\\new"', "C:\\mods\\new"],
			['"ends in \\\\"', "ends in \\"],
			['"ends in \\"', "ends in \\"],
			['"unknown \\q escape"', "unknown \\q escape"],
			['"two\nlines"', "two\nlines"],
			['"# not a comment"', "# not a comment"],
			["yes", sym("yes")],
			["GFX_goal_generic", sym("GFX_goal_generic")],
			["var:influence_array^0", sym("var:influence_array^0")],
			["ROOT.FROM.owner", sym("ROOT.FROM.owner")],
			["@icon_size", sym("@icon_size")],
			["[?my_var]", sym("[?my_var]")],
			["123.owner", sym("123.owner")],
			["50%", sym("50%")],
			["-2.5%%", sym("-2.5%%")],
			["1936.1.1", sym("1936.1.1")],
			["2030.1.1.12", sym("2030.1.1.12")],
		];

		for (const [text, expected] of values) {
			it(`reads ${JSON.stringify(text)} as ${JSON.stringify(expected)}`, () => {
				assert.deepStrictEqual(shapes(`a = ${text} b = 1`), [
					["a", "=", expected],
					["b", "=", 1],
				]);
			});
		}
	});

	describe("an operator", () => {
		for (const operator of ["=", "<", ">", "<=", ">=", "!="]) {
			it(`reads ${operator}`, () => {
				assert.deepStrictEqual(shapes(`a ${operator} 5`), [["a", operator, 5]]);
			});
		}
	});

	describe("structure", () => {
		const structures: [string, string, unknown[][]][] = [
			["nothing in an empty file", "", []],
			["nothing in a file of comments", "# one\n  # two", []],
			[
				"nested blocks",
				"focus = { id = a completion_reward = { add_stability = 0.1 } }",
				[["focus", "=", [["id", "=", sym("a")], ["completion_reward", "=", [["add_stability", "=", 0.1]]]]]],
			],
			["an empty block", "available = { }", [["available", "=", []]]],
			["a block written without its equals sign", "limit { tag = GER }", [["limit", "=", [["tag", "=", sym("GER")]]]]],
			[
				"bare entries, a quoted one keeping its quotes",
				'tags = { GER 12 "two words" }',
				[["tags", "=", [["GER", null, null], ["12", null, null], ['"two words"', null, null]]]],
			],
			[
				"commas and semicolons as separators",
				"a = 1, b = 2; c = { 1, 2; 3 }",
				[["a", "=", 1], ["b", "=", 2], ["c", "=", [["1", null, null], ["2", null, null], ["3", null, null]]]],
			],
			["comments around and after a statement", "# head\na = 1 # tail\n# foot", [["a", "=", 1]]],
			["Windows line endings", "a = 1\r\nb = 2\r\n", [["a", "=", 1], ["b", "=", 2]]],
			[
				"a block attached to a value",
				"color = rgb { 255 0 0 }",
				[["color", "=", [["255", null, null], ["0", null, null], ["0", null, null]], "rgb"]],
			],
			["a value followed by another statement, not attached", "a = b c = { }", [["a", "=", sym("b")], ["c", "=", []]]],
			["a history block named after its date", "1939.1.1 = { owner = GER }", [["1939.1.1", "=", [["owner", "=", sym("GER")]]]]],
			["a random_list branch named after its weight", "10 = { add_stability = 0.1 }", [["10", "=", [["add_stability", "=", 0.1]]]]],
			["a quoted name, keeping its quotes", '"Tank Corps" = 1', [['"Tank Corps"', "=", 1]]],
		];

		for (const [title, source, expected] of structures) {
			it(`reads ${title}`, () => {
				assert.deepStrictEqual(shapes(source), expected);
			});
		}

		it("returns a nameless root holding the top-level statements", () => {
			const root = parse("a = 1");
			assert.strictEqual(root.name, null);
			assert.strictEqual(root.operator, null);
			assert.strictEqual((root.value as Node[]).length, 1);
		});

		it("starts over on every call, even after a failed one", () => {
			assert.throws(() => parse("a = { b = ~ }"));
			assert.deepStrictEqual(shapes("c = 2"), [["c", "=", 2]]);
		});
	});

	describe("positions", () => {
		const source = [
			"# Millennium Dawn",
			"focus = {",
			'\tid = "SOV_five_year_plan"\r',
			"\tcost >= 10.5",
			"\tcolor = rgb { 255 0 0 }",
			"\tsearch_filters = { FOCUS_FILTER_POLITICAL }",
			"}",
		].join("\n");

		it("point every token at the text it was read from", () => {
			let seen = 0;
			walk(parseHoi4File(source), (node) => {
				for (const token of tokensOf(node)) {
					if (token) {
						seen++;
						assert.strictEqual(source.slice(token.start, token.end), token.value);
					}
				}
			});
			assert.ok(seen > 20, `only ${seen} tokens seen`);
		});

		it("mark the name, the operator and both ends of a block", () => {
			const node = (parseHoi4File("ab = { c = 12 }").value as Node[])[0];
			assert.deepStrictEqual(tokensOf(node), [
				{ value: "ab", start: 0, end: 2, type: "symbol" },
				{ value: "=", start: 3, end: 4, type: "operator" },
				{ value: "{", start: 5, end: 6, type: "operator" },
				{ value: "}", start: 14, end: 15, type: "operator" },
				null,
			]);
		});

		it("mark an attachment where it was written", () => {
			const node = (parseHoi4File("color = rgb { 1 }").value as Node[])[0];
			assert.deepStrictEqual(node.valueAttachmentToken, { value: "rgb", start: 8, end: 11, type: "symbol" });
			assert.strictEqual(node.valueStartToken?.value, "{");
		});

		it("are left out when keepTokens is false", () => {
			walk(parse(source), (node) => {
				assert.deepStrictEqual(tokensOf(node), [null, null, null, null, null]);
			});
		});
	});

	describe("a file that cannot be read", () => {
		const failures: [string, string, string][] = [
			["a character no token starts with", "a = ~", "Invalid token at (1, 4)"],
			["an operator where a name belongs", "= 1", "Expect name to be symbol, string or number at (1, 1)"],
			["a percentage where a name belongs", "50% = 1", "Expect name to be symbol, string or number at (1, 1)"],
			["a closing brace where a value belongs", "a = }", "Expect string, number, symbol, or { at (1, 4)"],
			["an operator with nothing after it", "a =", "Expect string, number, symbol, or { at (1, 4)"],
			["a block left open", "a = { b = 1", "Expect a '}' at (1, 12)"],
			["a closing brace too many", "a = 1 }", "File content can't be completely parsed"],
			["a mistake on a later line", "a = 1\nb = {\n  c = ~\n}", "Invalid token at (3, 6)"],
		];

		for (const [title, source, message] of failures) {
			it(`reports ${title}`, () => {
				assert.throws(
					() => parse(source),
					(error: unknown) => error instanceof UserError && error.message.startsWith(message),
				);
			});
		}

		it("quotes what follows the mistake, and marks the end of the file", () => {
			assert.throws(() => parse("a = { b = 1"), { message: "Expect a '}' at (1, 12): (EOF)" });
			assert.throws(() => parse("= 1"), { message: "Expect name to be symbol, string or number at (1, 1): = 1(EOF)" });
		});

		it("puts the caller's prefix in front of the message", () => {
			assert.throws(() => parseHoi4File("= 1", "events/SOV.txt: "), /^UserError: events\/SOV\.txt: Expect name/);
		});
	});

	describe("closeBlocksAtEof", () => {
		// Vanilla's interface/powerbalanceview.gfx never closes its spriteTypes.
		const source = 'spriteTypes = { spriteType = { name = "GFX_bop_left"';

		it("closes every block still open at the end of the file", () => {
			const root = parseHoi4File(source, "", { keepTokens: false, closeBlocksAtEof: true });
			assert.deepStrictEqual((root.value as Node[]).map(shape), [
				["spriteTypes", "=", [["spriteType", "=", [["name", "=", "GFX_bop_left"]]]]],
			]);
		});

		it("ends such a block at the end of the file", () => {
			const node = (parseHoi4File(source, "", { closeBlocksAtEof: true }).value as Node[])[0];
			assert.deepStrictEqual(node.valueEndToken, { value: "", start: source.length, end: source.length, type: "eof" });
		});

		it("still refuses a closing brace too many", () => {
			assert.throws(() => parseHoi4File("a = 1 }", "", { closeBlocksAtEof: true }), UserError);
		});
	});

	describe("resolveScriptVariables", () => {
		it("replaces every @constant the file defines, wherever it is defined and used", () => {
			const root = parse(`
				@width = 120
				@sprite = "GFX_window"
				window = {
					@inner = 4
					size = { width = @width margin = @inner }
					background = @sprite
					height = @missing
				}
			`);
			assert.strictEqual(resolveScriptVariables(root), root);
			assert.deepStrictEqual(shape(root)[2], [
				["@width", "=", 120],
				["@sprite", "=", "GFX_window"],
				[
					"window",
					"=",
					[
						["@inner", "=", 4],
						["size", "=", [["width", "=", 120], ["margin", "=", 4]]],
						["background", "=", "GFX_window"],
						["height", "=", sym("@missing")],
					],
				],
			]);
		});

		it("leaves a file without constants as it is", () => {
			const root = parse("size = { width = @width }");
			assert.deepStrictEqual(resolveScriptVariables(root), parse("size = { width = @width }"));
		});
	});
});
