import { traceDimClass, traceLineClass } from "../../src/util/hoi4gui/tracestyles";

// Prerequisite line tracing for a grid box tree. A dense tree draws hundreds of overlapping
// connector lines underneath the nodes, so following one by eye is guesswork. Shift+clicking a node
// dims every connection in the tree except the ones that node's own prerequisites produce. The
// nodes are left untouched -- only lines are filtered.

// Exported because the classes landing on the emitted connection divs is the whole behaviour, and
// only a DOM test can prove it.
export function applyPrerequisiteTrace(
	root: HTMLElement,
	nodeId: string | undefined,
): void {
	const connections = root.querySelectorAll("[data-conn-from]");
	for (let i = 0; i < connections.length; i++) {
		const connection = connections[i] as HTMLElement;
		connection.classList.remove(traceLineClass, traceDimClass);
		if (nodeId === undefined) {
			continue;
		}

		// data-conn-from is the node that owns the connection, and data-conn-type is written
		// before renderGridBoxConnection flips a diagonal "parent" to "child", so this pair means
		// exactly "a line one of this node's prerequisites produced". A mutually exclusive link is
		// "related" and dims with everything else.
		const isPrerequisiteOfTraced =
			connection.dataset.connFrom === nodeId &&
			connection.dataset.connType === "parent";
		connection.classList.add(
			isPrerequisiteOfTraced ? traceLineClass : traceDimClass,
		);
	}
}

export interface TracingOptions {
	// The element clicks are caught on, and the one the tree is rendered into.
	contentId: string;
	placeholderId: string;
	// The status line shown while a node is traced; the id comes from the mod file and is set as text.
	statusText: (nodeId: string) => string;
}

export interface Tracing {
	// Puts an active trace back on; the connection divs are new after every rebuild.
	reapply(): void;
}

// Wired to the shell elements, which outlive every rebuild of the tree, so this runs once.
export function subscribeTracing(options: TracingOptions): Tracing {
	let tracedId: string | undefined;

	const reapply = () => {
		const placeholder = document.getElementById(options.placeholderId);
		if (placeholder) {
			applyPrerequisiteTrace(placeholder, tracedId);
		}
	};

	const setTraced = (nodeId: string | undefined) => {
		tracedId = nodeId;
		reapply();

		const status = document.getElementById("trace-status");
		if (status) {
			status.textContent = nodeId ? options.statusText(nodeId) : "";
		}

		const container = document.getElementById("trace-status-container");
		if (container) {
			container.style.display = nodeId ? "flex" : "none";
		}
	};

	const content = document.getElementById(options.contentId);
	if (content) {
		content.addEventListener(
			"click",
			(e) => {
				if (!e.shiftKey) {
					return;
				}

				// Capture phase: stopping the event here is what keeps the bubble-phase .navigator
				// handler from also jumping to the node in the editor, and keeps a shift+click that
				// lands on a checkbox from ticking it.
				e.preventDefault();
				e.stopPropagation();

				const item = (e.target as Element | null)?.closest(
					"[data-gridbox-item]",
				) as HTMLElement | null;
				const id = item?.dataset.gridboxItem;
				if (!id) {
					return;
				}

				setTraced(id === tracedId ? undefined : id);
			},
			true,
		);
	}

	const clearButton = document.getElementById("clear-trace");
	clearButton?.addEventListener("click", () => setTraced(undefined));

	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && tracedId !== undefined) {
			setTraced(undefined);
		}
	});

	// Clicking empty canvas clears the trace. The end of a pan is a click on that same canvas, so
	// only a press that stayed where it started counts as one.
	const dragger = document.getElementById("dragger");
	if (dragger) {
		let downX = 0;
		let downY = 0;
		dragger.addEventListener("mousedown", (e) => {
			downX = e.pageX;
			downY = e.pageY;
		});
		dragger.addEventListener("mouseup", (e) => {
			if (
				tracedId !== undefined &&
				Math.abs(e.pageX - downX) < 4 &&
				Math.abs(e.pageY - downY) < 4
			) {
				setTraced(undefined);
			}
		});
	}

	return { reapply };
}
