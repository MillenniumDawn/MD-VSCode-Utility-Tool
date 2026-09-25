import { Region, WorldMapWarning } from "../definitions";
import {
	FileLoader,
	FolderLoader,
	LoadResult,
	LoadResultOD,
	sortItems,
	mergeRegionWithWarnings,
	shouldReloadDependencies,
} from "./common";
import { localize } from "../../../util/i18n";
import { UserError } from "../../../util/common";
import { LoaderSession } from "../../../util/loader/loader";

type LocalizedMessage = readonly [
	key: Parameters<typeof localize>[0],
	message: string,
];

// Everything that tells the state, supply area and strategic region loaders apart once their
// files are parsed: the warning source type and the texts of the warnings they share.
export interface RegionKind {
	sourceType: "state" | "strategicregion" | "supplyarea";
	// {0}: the largest id.
	idTooLarge: LocalizedMessage;
	// {0}: the id used more than once.
	idConflict: LocalizedMessage;
	// {0}: the missing id, or range of ids.
	notExist: LocalizedMessage;
	// {0}: the sub-region id, {1}: the region id.
	subRegionNotExist: LocalizedMessage;
	// {0}: the region id.
	noValidSubRegions: LocalizedMessage;
}

function text(message: LocalizedMessage, ...args: unknown[]): string {
	return localize(message[0], message[1], ...args);
}

export function sortRegionItems<T extends { id: number; file: string }>(
	items: T[],
	kind: RegionKind,
	warnings: WorldMapWarning[],
): { sorted: T[]; badId: number } {
	return sortItems(
		items,
		10000,
		(maxId) => {
			throw new UserError(text(kind.idTooLarge, maxId));
		},
		(newItem, existingItem, badId) =>
			warnings.push({
				source: [{ type: kind.sourceType, id: badId }],
				relatedFiles: [newItem.file, existingItem.file],
				text: text(kind.idConflict, newItem.id),
			}),
		(startId, endId) =>
			warnings.push({
				source: [{ type: kind.sourceType, id: startId }],
				relatedFiles: [],
				text: text(
					kind.notExist,
					startId === endId ? startId : `${startId}-${endId}`,
				),
			}),
	);
}

export function calculateRegionBoundingBox<
	K extends string,
	T extends { id: number; file: string } & { [k in K]: number[] },
>(
	item: T,
	subRegionIdType: K,
	subRegions: (Region | undefined | null)[],
	width: number,
	kind: RegionKind,
	warnings: WorldMapWarning[],
): T & Region {
	return mergeRegionWithWarnings(
		item,
		subRegionIdType,
		subRegions,
		width,
		kind.sourceType,
		warnings,
		(subRegionId) => text(kind.subRegionNotExist, subRegionId, item.id),
		() => text(kind.noValidSubRegions, item.id),
	);
}

// Gives every sorted item its bounding box from the sub-regions it lists. Items with a bad id sit
// at negative indexes, so the loop starts at `badId + 1`. `afterFill` runs right after each merge.
export function fillRegions<
	K extends string,
	T extends { id: number; file: string } & { [k in K]: number[] },
>(
	sorted: T[],
	badId: number,
	subRegionIdType: K,
	subRegions: (Region | undefined | null)[],
	width: number,
	kind: RegionKind,
	warnings: WorldMapWarning[],
	afterFill?: (region: T & Region) => void,
): { filled: (T & Region)[]; badCount: number } {
	const filled: (T & Region)[] = new Array(sorted.length);
	for (let i = badId + 1; i < sorted.length; i++) {
		const item = sorted[i];
		if (item) {
			const region = calculateRegionBoundingBox(
				item,
				subRegionIdType,
				subRegions,
				width,
				kind,
				warnings,
			);
			filled[i] = region;
			afterFill?.(region);
		}
	}

	return { filled, badCount: -badId - 1 };
}

export function worldMapFileLoader<T>(
	name: string,
	load: (file: string, warnings: WorldMapWarning[]) => Promise<T[]>,
): new (file: string) => FileLoader<T[]> {
	return class extends FileLoader<T[]> {
		protected async loadFromFile(): Promise<LoadResultOD<T[]>> {
			const warnings: WorldMapWarning[] = [];
			return {
				result: await load(this.file, warnings),
				warnings,
			};
		}

		public toString() {
			return `[${name}: ${this.file}]`;
		}
	};
}

// The folder half of a region loader: reloads when its own files or any loader it merges against
// changed, and announces itself before loading.
export abstract class RegionFolderLoader<T, F> extends FolderLoader<T, F> {
	constructor(
		folder: string,
		fileLoader: new (file: string) => FileLoader<F>,
		private name: string,
		private progress: LocalizedMessage,
	) {
		super(folder, fileLoader);
	}

	protected abstract dependencyLoaders(): {
		shouldReload(session: LoaderSession): Promise<boolean>;
	}[];

	public async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		return (
			(await super.shouldReloadImpl(session)) ||
			(await shouldReloadDependencies(session, this.dependencyLoaders()))
		);
	}

	protected async loadImpl(session: LoaderSession): Promise<LoadResult<T>> {
		await this.fireOnProgressEvent(text(this.progress));
		return super.loadImpl(session);
	}

	public toString() {
		return `[${this.name}]`;
	}
}
