/**
 * Contributions from one source (workspace, one parent, or vanilla). The ordinally greatest
 * relative file path wins a duplicate key. Paths are compared as written, case-sensitively, without
 * locale-dependent collation; read completion, cache record order and edit order do not participate.
 * Source precedence stays with the separate halves in indexFactory.ts.
 */
export class FilePrecedenceIndex<T> {
	public readonly index: Record<string, T | undefined> = Object.create(null);
	private readonly owners: Record<string, string | undefined> = Object.create(null);
	private readonly files = new Map<string, Record<string, T>>();
	// Most keys have one definition: only duplicates need a set of competing files.
	private readonly duplicates = new Map<string, Set<string>>();

	/** Replaces a file atomically after it has been successfully parsed. */
	public setFile(file: string, entries: Record<string, T>): void {
		const previous = this.files.get(file) ?? {};
		this.files.set(file, entries);
		for (const key of Object.keys(previous)) {
			if (!Object.hasOwn(entries, key)) {
				this.removeContribution(file, key);
			}
		}
		for (const key of Object.keys(entries)) {
			const owner = this.owners[key];
			if (owner === undefined) {
				this.owners[key] = file;
			} else if (owner !== file) {
				let candidates = this.duplicates.get(key);
				if (!candidates) {
					candidates = new Set([owner]);
					this.duplicates.set(key, candidates);
				}
				candidates.add(file);
				if (file > owner) {
					this.owners[key] = file;
				}
			}
			this.index[key] = this.files.get(this.owners[key]!)![key];
		}
	}

	public removeFile(file: string): void {
		for (const key of Object.keys(this.files.get(file) ?? {})) {
			this.removeContribution(file, key);
		}
		this.files.delete(file);
	}

	/** Actual per-file values, including shadowed definitions, copied for persistent caches. */
	public records(): { file: string; entries: Record<string, T> }[] {
		return [...this.files.keys()].sort().map(file => ({ file, entries: { ...this.files.get(file)! } }));
	}

	private removeContribution(file: string, key: string): void {
		const candidates = this.duplicates.get(key);
		if (candidates) {
			candidates.delete(file);
			let winner: string | undefined;
			for (const candidate of candidates) {
				if (winner === undefined || candidate > winner) {
					winner = candidate;
				}
			}
			// A duplicate set started with two files and loses just one contribution here.
			this.owners[key] = winner;
			this.index[key] = this.files.get(winner!)![key];
			if (candidates.size === 1) {
				this.duplicates.delete(key);
			}
		} else if (this.owners[key] === file) {
			delete this.owners[key];
			delete this.index[key];
		}
	}
}
