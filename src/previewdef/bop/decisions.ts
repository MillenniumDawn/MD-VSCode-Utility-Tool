import { HOIDecision, HOIDecisionFile, getDecisionsFromFile } from "../decision/schema";
import { listFilesFromModOrHOI4, parseHoi4FileCached, readFileFromModOrHOI4 } from "../../util/fileloader";
import { Logger } from "../../util/logger";
import { describeParseFailure } from "../../util/indexHalf";

export const decisionsFolder = "common/decisions";

// The row the game repeats in powerbalanceview's `decision_grid`, one per decision of the BoP's
// category. It lives in countrydecisionview.gui, next to the decisions tab's own rows.
export const decisionItemWindowName = "decision_item";

/**
 * The decisions a decisions file puts in `category`, in file order. A category can be opened more
 * than once in the same file, and every block counts.
 */
export function decisionsOfCategory(file: HOIDecisionFile, category: string): HOIDecision[] {
	return file.categories.filter((c) => c.name === category).flatMap((c) => c.decisions);
}

/**
 * Whether `content` opens a block named after one of `categories` at the start of a line, which is
 * how a decisions file opens a category. Cheap enough to run over every decisions file, so only the
 * ones that can hold a category are parsed.
 */
export function mentionsCategory(content: string, categories: readonly string[]): boolean {
	if (categories.length === 0) {
		return false;
	}
	const names = categories.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return new RegExp(`^[ \\t]*(?:${names})[ \\t]*=[ \\t]*\\{`, "m").test(content);
}

/**
 * Every decision in `categories`, keyed by category, from the top level of common/decisions in the
 * mod or the game install. A decisions file that does not parse is skipped, not a failed preview.
 */
export async function loadCategoryDecisions(
	categories: readonly string[],
): Promise<Record<string, HOIDecision[]>> {
	const result: Record<string, HOIDecision[]> = {};
	if (categories.length === 0) {
		return result;
	}

	const files = (await listFilesFromModOrHOI4(decisionsFolder))
		.filter((f) => f.toLowerCase().endsWith(".txt"))
		.sort()
		.map((f) => `${decisionsFolder}/${f}`);

	const parsed = await Promise.all(
		files.map(async (file): Promise<HOIDecisionFile | undefined> => {
			try {
				const [buffer] = await readFileFromModOrHOI4(file);
				if (!mentionsCategory(buffer.toString(), categories)) {
					return undefined;
				}
				return getDecisionsFromFile(await parseHoi4FileCached(file), file);
			} catch (e) {
				Logger.error(`Cannot read the decisions in ${file}: ${describeParseFailure(e)}`);
				return undefined;
			}
		}),
	);

	for (const category of categories) {
		result[category] = parsed.flatMap((f) => (f ? decisionsOfCategory(f, category) : []));
	}
	return result;
}
