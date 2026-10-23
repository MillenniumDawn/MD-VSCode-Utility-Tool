// Builds a roster a slice at a time, so a file of a thousand cards paints its first group
// immediately rather than freezing until the last card is built. The character and idea previews
// share it.

export type RenderTask = () => void;

export interface RenderedCard<C> {
	card: C;
	element: HTMLDivElement;
}

// Returns a runner with its own generation count. A run started while an earlier one is still
// painting stops the earlier one: the newer output is what belongs on screen, and the older run
// would otherwise append into a container it no longer owns.
export function taskRunner(): (tasks: RenderTask[], done: () => void) => void {
	let renderGeneration = 0;
	return (tasks, done) => {
		const generation = ++renderGeneration;
		let index = 0;

		// jsdom has no requestAnimationFrame, and the tests drive this path; running straight through
		// there is also what a test wants, since it has nothing to wait on.
		const schedule =
			typeof requestAnimationFrame === "function"
				? requestAnimationFrame
				: (fn: () => void) => {
						fn();
						return 0;
					};

		const step = () => {
			if (generation !== renderGeneration) {
				return;
			}

			const deadline = Date.now() + 8;
			while (index < tasks.length && Date.now() < deadline) {
				tasks[index]?.();
				index++;
			}

			if (index < tasks.length) {
				schedule(step);
			} else {
				done();
			}
		};

		step();
	};
}

// One group's tasks: the header and an empty flow first, so the group is on screen before its
// cards are, then the cards a batch at a time. `openGroup` puts the group on the page and returns
// the flow its cards go into.
export function pushGroupTasks<C>(
	tasks: RenderTask[],
	openGroup: () => HTMLDivElement,
	cards: C[],
	cardsPerBatch: number,
	buildCard: (card: C) => HTMLDivElement,
	rendered: RenderedCard<C>[],
): void {
	// Set by the first task, which always runs before the batches.
	let flow!: HTMLDivElement;
	tasks.push(() => {
		flow = openGroup();
	});

	for (let i = 0; i < cards.length; i += cardsPerBatch) {
		const batch = cards.slice(i, i + cardsPerBatch);
		tasks.push(() => {
			for (const card of batch) {
				const element = buildCard(card);
				rendered.push({ card, element });
				flow.appendChild(element);
			}
		});
	}
}
