import { UserError } from "../util/common";

export type NodeValue = string | number | Node[] | SymbolNode | null;

export interface Node {
	name: string | null;
	operator: string | null;
	value: NodeValue;
	valueAttachment: SymbolNode | null;
	valueAttachmentToken: Token | null;
	nameToken: Token | null;
	operatorToken: Token | null;
	valueStartToken: Token | null;
	valueEndToken: Token | null;
}

export interface SymbolNode {
	name: string;
}

interface Tokenizer<T extends string> {
	peek: () => Token<T>;
	next: () => Token<T>;
	throw: (message: string, prev?: boolean) => never;
}

// These used to be `value.match(/^[,;]$/)`. A regex literal is a fresh RegExp object every time
// the expression is evaluated, and a matching `.match` allocates a result array on top, two or
// three times per node parsed -- to ask whether a one-character string is a separator.
function isSeparator(value: string): boolean {
	return value === "," || value === ";";
}

function isSeparatorOrClose(value: string): boolean {
	return value === "," || value === ";" || value === "}";
}

export interface Token<T extends string = string> {
	value: string;
	start: number;
	end: number;
	type: T;
}

function tokenizer(
	input: string,
	errorMessagePrefix: string = "",
): Tokenizer<HOITokenType> {
	tokenRegex.lastIndex = 0;
	let prevPos = 0;
	let pos = 0;
	let token: Token<HOITokenType> | null = null;
	let groups: RegExpExecArray | null = null;

	let lineLengthSums: number[] | null = null;

	function nextGroups() {
		prevPos = pos;
		do {
			groups = tokenRegex.exec(input);
			if (groups === null) {
				throwError("Invalid token");
			}

			const result = groups[1];
			if (result === undefined) {
				throwError("Invalid token");
			}
			// input = input.substr(groups[0].length);
			pos += groups[0].length;

			// Exactly one alternative matched, so the first group that is set names the type.
			let type: HOITokenType | undefined;
			for (let g = 0; g < tokenTypeByGroup.length; g++) {
				if (groups[g + 2] !== undefined) {
					type = tokenTypeByGroup[g];
					break;
				}
			}

			token = {
				value: result,
				start: pos - result.length,
				end: pos,
				type: type as HOITokenType,
			};
		} while (token?.type === "comment");
	}

	function peek(): Token<HOITokenType> {
		if (groups !== null) {
			return token!;
		}

		nextGroups();
		return token!;
	}

	function throwError(message: string, prev: boolean = false): never {
		const calculatePos = prev ? prevPos : pos;
		if (lineLengthSums === null) {
			let sum = 0;
			lineLengthSums = input
				.split("\n")
				.map((v) => v.length)
				.map((v) => (sum = sum + v + 1));
		}
		const sums = lineLengthSums;
		const line = sums.findIndex((v) => v > calculatePos);
		const column =
			line > 0 ? calculatePos - (sums[line - 1] ?? 0) : calculatePos;
		const lastSum = sums[sums.length - 1] ?? 0;
		const previousSum = sums[sums.length - 2] ?? 0;
		const posString =
			line === -1
				? ` at (${sums.length}, ${sums.length > 1 ? lastSum - previousSum + 1 : lastSum + 1})`
				: ` at (${line + 1}, ${column + 1})`;
		throw new UserError(
			errorMessagePrefix +
				message +
				`${posString}: ` +
				(input + "(EOF)").substring(
					calculatePos,
					Math.min(calculatePos + 30, input.length + 5),
				),
		);
	}

	return {
		peek,
		next: () => {
			const result = peek();
			groups = null;
			return result;
		},
		throw: throwError,
	};
}

type HOITokenType =
	| "comment"
	| "symbol"
	| "operator"
	| "string"
	| "number"
	| "unitnumber"
	| "eof";
const tokenRegexStrings: Record<HOITokenType, [string, number]> = {
	comment: ["#.*(?:[\\r\\n]|$)", 0],
	symbol: [
		"(?:\\d+\\.)?[a-zA-Z_@\\[\\]][\\w:\\._@\\[\\]\\-\\?\\^\\/\\u00A0-\\u024F|]*",
		40,
	],
	operator: ["[={}<>;,]|>=|<=|!=", 10],
	string: ['"(?:\\\\"|\\\\\\\\|[^"])*"', 10],
	number: ["-?\\d*\\.\\d+|-?\\d+|0x\\d+", 50],
	unitnumber: ["(?:-?\\d*\\.\\d+|-?\\d+)(?:%%?)", 49],
	eof: ["$", 1000],
};

const tokenTypeEntries = Object.entries<[string, number]>(
	tokenRegexStrings,
).sort((a, b) => a[1][1] - b[1][1]);

/*
 * Numbered groups, not named ones. A regex with named groups makes V8 build a fresh object
 * holding every group on each exec, and recovering which alternative matched then meant a
 * linear search over that object. This is the innermost loop of every parse in the extension --
 * millions of tokens per index build -- so both costs are paid per token.
 *
 * Group 1 is the whole token; groups 2..n are the alternatives in the order below. None of the
 * sub-patterns capture (they all use `(?:...)`), so those indices stay fixed.
 */
const tokenTypeByGroup: HOITokenType[] = tokenTypeEntries.map(
	([name]) => name as HOITokenType,
);
const tokenRegex = new RegExp(
	"\\s*(" + tokenTypeEntries.map(([, [s]]) => `(${s})`).join("|") + ")",
	"y",
);

export interface ParseOptions {
	/**
	 * When false, position Tokens (nameToken, operatorToken, value*Token) are not stored on the
	 * resulting nodes. Index builds only need names/values, not editor positions, so dropping the
	 * tokens substantially lowers peak RAM while parsing many files. Defaults to true.
	 */
	keepTokens?: boolean;
}

export function parseHoi4File(
	input: string,
	errorMessagePrefix: string = "",
	options: ParseOptions = {},
): Node {
	const keepTokens = options.keepTokens !== false;
	const tokens = tokenizer(input, errorMessagePrefix);
	const value = parseBlockContent(tokens, keepTokens);

	if (tokens.peek().type !== "eof") {
		tokens.throw("File content can't be completely parsed");
	}

	return {
		name: null,
		nameToken: null,
		operator: null,
		operatorToken: null,
		value,
		valueStartToken: null,
		valueEndToken: null,
		valueAttachment: null,
		valueAttachmentToken: null,
	};
}

/**
 * Resolves HOI4 script constants. Files (scripted GUI especially) define `@name = <number|string>`
 * at the top and reference `@name` in places like `size = { width = @MY_WIDTH }`. The parser keeps
 * `@name` as a symbol, so without this pass those numeric fields become undefined and the windows
 * collapse to zero size (issue: scripted GUI files showing nothing). This substitutes every
 * `@name` reference with its defined value, in place. Inline `@[ expr ]` expressions are left as-is.
 */
export function resolveScriptVariables(root: Node): Node {
	const constants: Record<string, number | string> = {};
	const collect = (node: Node) => {
		if (
			node.name &&
			node.name.startsWith("@") &&
			(typeof node.value === "number" || typeof node.value === "string")
		) {
			constants[node.name] = node.value;
		}
		if (Array.isArray(node.value)) {
			node.value.forEach(collect);
		}
	};
	collect(root);

	if (Object.keys(constants).length === 0) {
		return root;
	}

	const substitute = (node: Node) => {
		const value = node.value;
		if (Array.isArray(value)) {
			value.forEach(substitute);
		} else if (value !== null && typeof value === "object" && "name" in value) {
			const name = value.name;
			const constant = constants[name];
			if (name.startsWith("@") && constant !== undefined) {
				node.value = constant;
			}
		}
	};
	substitute(root);

	return root;
}

function parseNode(tokens: Tokenizer<HOITokenType>, keepTokens: boolean): Node {
	const name = tokens.next();
	if (
		name.type !== "string" &&
		name.type !== "symbol" &&
		name.type !== "number"
	) {
		tokens.throw("Expect name to be symbol, string or number", true);
	}

	let nextToken = tokens.peek();
	if (nextToken.type !== "operator" || isSeparatorOrClose(nextToken.value)) {
		while (isSeparator(nextToken.value)) {
			tokens.next();
			nextToken = tokens.peek();
		}

		return {
			name: name.value,
			nameToken: keepTokens ? name : null,
			operator: null,
			operatorToken: null,
			value: null,
			valueStartToken: null,
			valueEndToken: null,
			valueAttachment: null,
			valueAttachmentToken: null,
		};
	}

	let operator: Token<HOITokenType>;
	if (nextToken.value === "{") {
		operator = {
			...nextToken,
			value: "=",
		};
	} else {
		operator = tokens.next();
	}

	let valueAttachment: SymbolNode | null = null;
	let valueAttachmentToken: Token | null = null;
	let [value, valueStartToken, valueEndToken] = parseNodeValue(
		tokens,
		keepTokens,
	);

	if (value !== null && typeof value === "object" && "name" in value) {
		const nextToken = tokens.peek();
		if (nextToken.value === "{") {
			valueAttachment = value;
			valueAttachmentToken = valueStartToken;
			[value, valueStartToken, valueEndToken] = parseNodeValue(
				tokens,
				keepTokens,
			);
		}
	}

	let tailComma = tokens.peek();
	while (isSeparator(tailComma.value)) {
		tokens.next();
		tailComma = tokens.peek();
	}

	return {
		name: name.value,
		nameToken: keepTokens ? name : null,
		operator: operator.value,
		operatorToken: keepTokens ? operator : null,
		value,
		valueStartToken: keepTokens ? valueStartToken : null,
		valueEndToken: keepTokens ? valueEndToken : null,
		valueAttachment,
		valueAttachmentToken: keepTokens ? valueAttachmentToken : null,
	};
}

function parseNodeValue(
	tokens: Tokenizer<HOITokenType>,
	keepTokens: boolean,
): [NodeValue, Token<HOITokenType>, Token<HOITokenType>] {
	const nextToken = tokens.next();
	switch (nextToken.type) {
		case "string":
			return [
				nextToken.value
					.substr(1, nextToken.end - nextToken.start - 2)
					.replace(/\\"/g, '"')
					.replace(/\\\\/g, "\\"),
				nextToken,
				nextToken,
			];
		case "number":
			const nextTokenValue = nextToken.value;
			return [
				nextTokenValue.startsWith("0x")
					? parseInt(nextTokenValue.substr(2), 16)
					: parseFloat(nextTokenValue),
				nextToken,
				nextToken,
			];
		case "symbol":
		case "unitnumber":
			return [{ name: nextToken.value }, nextToken, nextToken];
		case "operator":
			if (nextToken.value === "{") {
				const result = parseBlockContent(tokens, keepTokens);
				const right = tokens.next();
				if (right.value !== "}") {
					tokens.throw("Expect a '}'", true);
				}
				return [result, nextToken, right];
			}
			break;
	}

	tokens.throw("Expect string, number, symbol, or {", true);
}

function parseBlockContent(
	tokens: Tokenizer<HOITokenType>,
	keepTokens: boolean,
): Node[] {
	const nodes: Node[] = [];

	while (true) {
		const nextToken = tokens.peek();
		if (nextToken.type === "eof" || nextToken.value === "}") {
			break;
		}

		nodes.push(parseNode(tokens, keepTokens));
	}

	return nodes;
}
