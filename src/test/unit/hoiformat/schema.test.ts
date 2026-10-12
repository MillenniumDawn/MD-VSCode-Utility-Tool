import * as assert from "assert";
import { Node, NodeValue, parseHoi4File } from "../../../hoiformat/hoiparser";
import {
	CustomMap,
	DetailValue,
	Enum,
	Position,
	Raw,
	SchemaDef,
	convertNodeToJson,
	emptyMap,
	isSymbolNode,
	parseNumberLike,
	positionSchema,
	readNodeAsString,
	readRawAsString,
	toNumberLike,
	toStringAsSymbolIgnoreCase,
} from "../../../hoiformat/schema";
import { first, parse } from "../hoi";

const numberLike = (_value: number, _unit?: string) => ({ _value, _unit, _token: undefined });
const ignoreCase = (_name: string) => ({ _name, _stringAsSymbolIgnoreCase: true, _token: undefined });
const enumOf = (..._values: string[]) => ({ _values, _token: undefined });
const mapOf = (entries: Record<string, unknown>) => ({
	_map: Object.assign(
		emptyMap(),
		Object.fromEntries(Object.entries(entries).map(([_key, _value]) => [_key, { _value, _key }])),
	),
	_token: undefined,
});

// The schema is whatever the table row says, so the typed surface is bypassed on purpose.
function convert(node: Node, schema: unknown, constants?: Record<string, NodeValue>): unknown {
	return convertNodeToJson<unknown>(node, schema as SchemaDef<unknown>, constants);
}

interface Icon {
	name: string;
	trigger: Raw;
	_index: number;
}

interface Focus {
	id: string;
	cost: number;
	x: DetailValue<number>;
	icon: Icon[];
	text: string[];
	search_filters: Enum;
	modifier: CustomMap<number>;
	position: Position;
	ai_will_do: Raw;
	cancel_if_invalid: boolean;
}

const focusSchema: SchemaDef<Focus> = {
	id: "string",
	cost: "number",
	x: { _innerType: "number", _type: "detailvalue" },
	icon: { _innerType: { name: "string", trigger: "raw" }, _type: "array" },
	text: { _innerType: "string", _type: "array" },
	search_filters: "enum",
	modifier: { _innerType: "number", _type: "map" },
	position: positionSchema,
	ai_will_do: "raw",
	cancel_if_invalid: "boolean",
};

const emptyFocus = {
	icon: [],
	text: [],
	search_filters: enumOf(),
	modifier: mapOf({}),
	_token: undefined,
};

describe("hoiformat/schema", () => {
	describe("a field", () => {
		const fields: [string, string, unknown][] = [
			["string", '"Five Year Plan"', "Five Year Plan"],
			["string", "GFX_goal", "GFX_goal"],
			["string", "var:my_var", "var:my_var"],
			["string", "5", "5"],
			["string", "{ }", undefined],
			["number", "5", 5],
			["number", "-0.5", -0.5],
			// A variable reads as 0, or as the default written after its `?`.
			["number", "my_var", 0],
			["number", "var:my_var?3", 3],
			["number", "50%", undefined],
			["number", '"5"', undefined],
			["numberlike", "5", numberLike(5)],
			["numberlike", "50%", numberLike(50, "%")],
			["numberlike", "-2.5%%", numberLike(-2.5, "%%")],
			["numberlike", "wide", undefined],
			["numberlike", '"5"', undefined],
			["stringignorecase", "Center_Up", ignoreCase("center_up")],
			["stringignorecase", '"UPPER_LEFT"', ignoreCase("upper_left")],
			["stringignorecase", "5", undefined],
			["boolean", "yes", true],
			["boolean", "no", false],
			["boolean", "maybe", undefined],
			["boolean", "1", undefined],
			["enum", "{ infantry armor }", enumOf("infantry", "armor")],
			["enum", '{ "trickster" "two words" "say \\"hi\\"" }', enumOf("trickster", "two words", 'say "hi"')],
			["enum", "{ }", enumOf()],
			["enum", "infantry", enumOf()],
		];

		for (const [schema, text, expected] of fields) {
			it(`of ${schema} reads ${text} as ${JSON.stringify(expected)}`, () => {
				assert.deepStrictEqual(convert(first(`a = ${text}`), schema), expected);
			});
		}

		it("of raw keeps the node itself", () => {
			const node = first("ai_will_do = { factor = 2 }");
			assert.strictEqual((convert(node, "raw") as Raw)._raw, node);
		});
	});

	describe("a block", () => {
		it("reads every kind of field, whatever case its key is written in", () => {
			const node = first(`
				focus = {
					ID = SOV_plan
					cost = 5
					Cost = 10 # the last of a repeated field wins
					x > 3
					icon = { name = GFX_a }
					not_in_the_schema = { deep = 1 }
					icon = { name = GFX_b }
					text = "first"
					text = second
					search_filters = { FOCUS_FILTER_POLITICAL }
					search_filters = { "FOCUS_FILTER_STABILITY" }
					modifier = { stability_factor = 0.1 }
					modifier = { war_support_factor = -0.05 }
					position = { x = 10 y = 20% }
					cancel_if_invalid = no
				}
			`);

			assert.deepStrictEqual(convert(node, focusSchema), {
				id: "SOV_plan",
				cost: 10,
				x: {
					_value: 3,
					_operator: ">",
					_attachment: undefined,
					_attachmentToken: undefined,
					_operatorToken: undefined,
					_startToken: undefined,
					_endToken: undefined,
					_token: undefined,
				},
				// A repeated list field collects every block, each with its place in the parent.
				icon: [
					{ name: "GFX_a", _index: 4, _token: undefined },
					{ name: "GFX_b", _index: 6, _token: undefined },
				],
				text: ["first", "second"],
				search_filters: enumOf("FOCUS_FILTER_POLITICAL", "FOCUS_FILTER_STABILITY"),
				modifier: mapOf({ stability_factor: 0.1, war_support_factor: -0.05 }),
				position: { x: numberLike(10), y: numberLike(20, "%"), _token: undefined },
				cancel_if_invalid: false,
				_token: undefined,
			});
		});

		it("starts every node with empty lists of its own", () => {
			const filled = convert(first("focus = { text = a search_filters = { b } modifier = { c = 1 } }"), focusSchema);
			assert.deepStrictEqual(convert(first("focus = { }"), focusSchema), emptyFocus);
			assert.notDeepStrictEqual(filled, emptyFocus);
		});

		it("reads a value that is not a block as an empty one", () => {
			assert.deepStrictEqual(convert(first("focus = none"), focusSchema), emptyFocus);
		});

		it("ignores a key that only an object's prototype has", () => {
			const node = first("focus = { constructor = a toString = b hasOwnProperty = c __proto__ = d }");
			assert.deepStrictEqual(convert(node, focusSchema), emptyFocus);
		});

		it("keeps a map entry named after a prototype slot as an ordinary entry", () => {
			const map = convert(first("modifier = { __proto__ = 1 constructor = 2 toString = 3 }"), {
				_innerType: "number",
				_type: "map",
			});
			// Computed, because a literal `__proto__:` sets the prototype instead of a key.
			assert.deepStrictEqual(map, mapOf({ ["__proto__"]: 1, constructor: 2, toString: 3 }));
			assert.deepStrictEqual(Object.keys((map as CustomMap<number>)._map), ["__proto__", "constructor", "toString"]);
		});

		it("carries the operator, the attachment and their positions on a detail value", () => {
			const node = (parseHoi4File("color = rgb { 255 0 0 }").value as Node[])[0];
			assert.deepStrictEqual(convert(node, { _innerType: "enum", _type: "detailvalue" }), {
				_value: { _values: ["255", "0", "0"], _token: node.nameToken },
				_operator: "=",
				_attachment: "rgb",
				_attachmentToken: node.valueAttachmentToken,
				_operatorToken: node.operatorToken,
				_startToken: node.valueStartToken,
				_endToken: node.valueEndToken,
				_token: node.nameToken,
			});
			assert.strictEqual(node.valueAttachmentToken?.value, "rgb");
		});

		it("marks a converted block with the position of its name", () => {
			const node = (parseHoi4File("focus = { id = a }").value as Node[])[0];
			assert.strictEqual((convert(node, focusSchema) as { _token: unknown })._token, node.nameToken);
			assert.strictEqual(node.nameToken?.value, "focus");
		});
	});

	describe("an @constant", () => {
		const fileSchema = { focus: { _innerType: focusSchema, _type: "array" } };

		it("is replaced in every field after its definition, at any depth", () => {
			const file = convert(
				parse(`
					@big = 70
					@icon = "GFX_big"
					focus = {
						id = @icon
						cost = @big
						position = { x = @big y = @unset }
						modifier = { @bonus = 0.5 stability_factor = @bonus }
					}
				`),
				fileSchema,
			) as { focus: unknown[] };

			assert.deepStrictEqual(file.focus, [
				{
					...emptyFocus,
					id: "GFX_big",
					cost: 70,
					position: { x: numberLike(70), y: undefined, _token: undefined },
					modifier: mapOf({ stability_factor: 0.5 }),
					_index: 2,
				},
			]);
		});

		it("comes from the caller too, which gets back the ones the file defines", () => {
			const constants: Record<string, NodeValue> = { "@given": 3 };
			const file = convert(parse("@found = 9 focus = { cost = @given }"), fileSchema, constants) as {
				focus: { cost: number }[];
			};
			assert.strictEqual(file.focus[0].cost, 3);
			assert.deepStrictEqual(constants, { "@given": 3, "@found": 9 });
		});
	});

	describe("a schema that is not one", () => {
		const broken: [string, unknown, RegExp][] = [
			["an unknown field type", "colour", /Unknown schema colour/],
			["a value that is no schema at all", 5, /Bad schema 5/],
			["a list outside a block", { _innerType: "string", _type: "array" }, /Array can't be here/],
		];

		for (const [title, schema, message] of broken) {
			it(`refuses ${title}`, () => {
				assert.throws(() => convert(first("a = 1"), schema), message);
			});
		}
	});

	describe("parseNumberLike", () => {
		const numberLikes: [string, number | undefined, string?][] = [
			["50%", 50, "%"],
			["5%%", 5, "%%"],
			["-1.5%", -1.5, "%"],
			[".5%", 0.5, "%"],
			["5.%", 5, "%"],
			["5", undefined],
			["%", undefined],
			["half%", undefined],
			["5%%%", undefined],
		];

		for (const [text, value, unit] of numberLikes) {
			it(`reads ${text} as ${value === undefined ? "nothing" : `${value} ${unit}`}`, () => {
				assert.deepStrictEqual(parseNumberLike(text), value === undefined ? undefined : numberLike(value, unit));
			});
		}
	});

	describe("reading a value as text", () => {
		const texts: [string, string | undefined][] = [
			['a = "quoted"', "quoted"],
			["a = bare", "bare"],
			["a = 5", undefined],
			["a = { }", undefined],
			["a", undefined],
		];

		for (const [source, expected] of texts) {
			it(`reads ${source} as ${JSON.stringify(expected)}`, () => {
				const node = first(source);
				assert.strictEqual(readNodeAsString(node), expected);
				assert.strictEqual(readRawAsString({ _raw: node, _token: undefined }), expected);
			});
		}

		it("reads a missing field as nothing", () => {
			assert.strictEqual(readRawAsString(undefined), undefined);
		});
	});

	describe("helpers", () => {
		it("isSymbolNode holds for a bare token only", () => {
			assert.strictEqual(isSymbolNode({ name: "yes" }), true);
			for (const value of ["yes", 5, null, []] as NodeValue[]) {
				assert.strictEqual(isSymbolNode(value), false);
			}
		});

		it("emptyMap has no prototype for a key from the file to land on", () => {
			assert.strictEqual(Object.getPrototypeOf(emptyMap()), null);
		});

		it("toNumberLike wraps a number without a unit", () => {
			assert.deepStrictEqual(toNumberLike(5), numberLike(5));
		});

		it("toStringAsSymbolIgnoreCase wraps the name it was given", () => {
			assert.deepStrictEqual(toStringAsSymbolIgnoreCase("center"), ignoreCase("center"));
		});
	});
});
