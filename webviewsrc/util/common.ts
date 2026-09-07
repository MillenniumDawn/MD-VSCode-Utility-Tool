import { BehaviorSubject } from "rxjs";
import { enableDropdowns, numDropDownOpened$ } from "./dropdown";
import { enableCheckboxes } from "./checkbox";
import { feLocalize } from "./i18n";
import { vscode } from "./vscode";
import { sendException } from "./telemetry";
import { forceError } from "../../src/util/common";
export { arrayToMap } from "../../src/util/common";

// True while the mouse is held down on the drag layer, i.e. while the view is being panned. A
// preview subscribes to it to keep hover popups out of the way of a drag; the `panning` class on
// <body> is the same signal for stylesheets.
export const panning$ = new BehaviorSubject<boolean>(false);

export function setState(obj: Record<string, any>): void {
	const state = getState();
	Object.assign(state, obj);
	vscode.setState(state);
}

export function getState(): Record<string, any> {
	return vscode.getState() || {};
}

// A toolbar toggle is the reader's preference, not this panel's scroll position, so it is kept by
// the host rather than in the state above: `vscode.setState` dies with the panel, and the reader
// opens a new panel every time they preview a file. The host renders whatever it has stored into
// `window.previewOptions` and takes the writes back through `setPreviewOption`; the default stays
// here, at the toggle, since a key nothing has been stored for is simply absent.
export function previewOption(key: string, fallback: boolean): boolean {
	const value = ((window as any).previewOptions ?? {})[key];
	return typeof value === "boolean" ? value : fallback;
}

export function setPreviewOption(key: string, value: boolean): void {
	vscode.postMessage({ command: "setPreviewOption", key, value });
}

export function scrollToState() {
	const state = getState();
	const xOffset = state.xOffset || 0;
	const yOffset = state.yOffset || 0;
	window.scroll(xOffset, yOffset);
}

export function copyArray<T>(
	src: T[],
	dst: T[],
	offsetSrc: number,
	offsetDst: number,
	length: number,
): void {
	for (let i = offsetSrc, j = offsetDst, k = 0; k < length; i++, j++, k++) {
		dst[j] = src[i]!;
	}
}

export function subscribeNavigators() {
	const navigators = document.getElementsByClassName("navigator");
	for (let i = 0; i < navigators.length; i++) {
		const navigator = navigators[i] as HTMLDivElement;
		navigator.addEventListener("click", function (e) {
			e.stopPropagation();
			const startStr = this.attributes.getNamedItem("start")?.value;
			const endStr = this.attributes.getNamedItem("end")?.value;
			const file = this.attributes.getNamedItem("file")?.value;
			const start =
				!startStr || startStr === "undefined" ? undefined : parseInt(startStr);
			const end = !endStr ? undefined : parseInt(endStr);
			navigateText(start, end, file);
		});
	}
}

export function tryRun<T extends (...args: any[]) => any>(
	func: T,
): (...args: Parameters<T>) => ReturnType<T> | undefined {
	return function (this: any, ...args) {
		try {
			const result = func.apply(this, args);
			if (result instanceof Promise) {
				return result.catch((e) => {
					console.error(e);
					sendException(forceError(e));
				}) as ReturnType<T>;
			}

			return result;
		} catch (e) {
			console.error(e);
			sendException(forceError(e));
		}

		return undefined;
	};
}

// The zoom the reader has the canvas at. Written by enableZoom below, and read by anything drawn
// outside the canvas -- a hover popup appended to <body> -- which has to scale itself by hand to
// stay the size of the card it belongs to.
export function currentScale(): number {
	return getState().scale || 1;
}

let shouldDisableZoom = false;

const minScale = 0.2;
const maxScale = 1;
const scaleStep = 0.2;

// The zoom of the preview this webview is showing, so the buttons, the keys and the wheel can all
// reach it. There is one preview per webview, so one handle is enough; before it is set -- a
// preview that never enables zoom -- every entry point below is a no-op. It is also what keeps the
// window listeners honest: they are registered once, against whichever zoom is current, rather than
// one more listener holding one more private `scale` per enableZoom call.
let activeZoom: ((delta: number, pageX: number, pageY: number) => void) | undefined;
let activeZoomTop = 0;
let zoomListenersRegistered = false;

// A zoom step from a control rather than from the pointer. The wheel keeps the point under the
// cursor still; a button has no cursor to keep still, so it holds the middle of the canvas -- the
// visible area below the toolbar strip, which is what the preview's yOffset measures.
function zoomFromControl(delta: number): void {
	activeZoom?.(
		delta,
		window.pageXOffset + window.innerWidth / 2,
		window.pageYOffset + (activeZoomTop + window.innerHeight) / 2,
	);
}

export function enableZoom(
	contentElement: HTMLDivElement | null,
	xOffset: number,
	yOffset: number,
): void {
	if (!contentElement) {
		return;
	}

	let scale = getState().scale || 1;
	contentElement.style.transform = `scale(${scale})`;
	contentElement.style.transformOrigin = "0 0";

	activeZoomTop = yOffset;
	activeZoom = function (delta: number, pageX: number, pageY: number) {
		const oldScale = scale;
		// Rounded to whole percents: the 0.2 steps do not land on exact tenths -- 1 - 0.2 - 0.2 is
		// 0.6000000000000001 -- and the drift would otherwise reach both the transform and the
		// readout, and stop a step at a clamp from comparing equal to the clamp.
		scale =
			Math.round(Math.min(maxScale, Math.max(minScale, scale + delta)) * 100) /
			100;
		if (scale === oldScale) {
			return;
		}

		const oldScrollX = window.scrollX;
		const oldScrollY = window.scrollY;

		contentElement.style.transform = `scale(${scale})`;
		setState({ scale });
		updateZoomControls(scale);

		const nextScrollX =
			((pageX - xOffset) * scale) / oldScale + xOffset - (pageX - oldScrollX);
		const nextScrollY =
			((pageY - yOffset) * scale) / oldScale + yOffset - (pageY - oldScrollY);
		window.scrollTo(nextScrollX, nextScrollY);
	};

	installZoomControls(scale);

	if (zoomListenersRegistered) {
		return;
	}
	zoomListenersRegistered = true;

	window.addEventListener(
		"wheel",
		function (e) {
			if (shouldDisableZoom) {
				return;
			}

			// A bare wheel is the reader moving the camera -- a two-finger swipe on a trackpad, or a
			// mouse wheel -- so it is left to scroll the document, which is what panning already is
			// here. Zoom is the modified gesture, as it is everywhere else: ctrl/cmd + wheel, which
			// is also what a trackpad pinch sends.
			if (!e.ctrlKey && !e.metaKey) {
				return;
			}

			e.preventDefault();
			if (e.deltaY === 0) {
				return;
			}

			activeZoom?.(
				e.deltaY > 0 ? -scaleStep : scaleStep,
				e.pageX,
				e.pageY,
			);
		},
		{
			passive: false,
		},
	);

	window.addEventListener("keydown", onZoomKey);
}

// The +/- overlay, built here rather than by each preview's contentbuilder: it belongs to zoom, and
// every preview that has zoom calls this. Built once -- a second call in the same document, which
// only happens in tests, reuses the controls it already made.
function installZoomControls(scale: number): void {
	let controls = document.getElementById("zoom-controls");
	if (!controls) {
		controls = document.createElement("div");
		controls.id = "zoom-controls";
		controls.innerHTML =
			`<button id="zoom-out" title="${feLocalize("zoom.out", "Zoom out (-)")}">` +
			`<i class="codicon codicon-zoom-out"></i></button>` +
			`<span id="zoom-level"></span>` +
			`<button id="zoom-in" title="${feLocalize("zoom.in", "Zoom in (+)")}">` +
			`<i class="codicon codicon-zoom-in"></i></button>`;
		document.body.appendChild(controls);

		controls
			.querySelector("#zoom-out")
			?.addEventListener("click", () => zoomFromControl(-scaleStep));
		controls
			.querySelector("#zoom-in")
			?.addEventListener("click", () => zoomFromControl(scaleStep));
	}

	updateZoomControls(scale);
}

function updateZoomControls(scale: number): void {
	const level = document.getElementById("zoom-level");
	if (level) {
		// Rounded because the 0.2 steps do not land on exact tenths -- 1 - 0.2 - 0.2 is
		// 0.6000000000000001, and that is not a zoom level anyone wants to read.
		level.textContent = `${Math.round(scale * 100)}%`;
	}

	const out = document.getElementById("zoom-out") as HTMLButtonElement | null;
	const zoomIn = document.getElementById("zoom-in") as HTMLButtonElement | null;
	if (out) {
		out.disabled = scale <= minScale;
	}
	if (zoomIn) {
		zoomIn.disabled = scale >= maxScale;
	}
}

// True when the key was aimed at something that takes keys of its own, so a `-` meant for the
// searchbox does not zoom the canvas instead. The combobox arm is the DivDropdown element: it is a
// <div>, not a <select>, and shouldDisableZoom only covers it while it is open.
function isTextEntry(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	if (!element?.tagName) {
		return false;
	}

	const tag = element.tagName.toLowerCase();
	return (
		tag === "input" ||
		tag === "textarea" ||
		tag === "select" ||
		element.isContentEditable === true ||
		element.getAttribute("role") === "combobox"
	);
}

function onZoomKey(e: KeyboardEvent): void {
	// A dropdown owns the keyboard while it is open, and a modified key belongs to VS Code.
	if (
		shouldDisableZoom ||
		e.ctrlKey ||
		e.metaKey ||
		e.altKey ||
		isTextEntry(e.target)
	) {
		return;
	}

	// `=` is the unshifted `+` on most layouts, `_` the shifted `-`, and the numpad keys report
	// their own codes whatever the layout does with them.
	const zoomIn = e.key === "+" || e.key === "=" || e.code === "NumpadAdd";
	const zoomOut = e.key === "-" || e.key === "_" || e.code === "NumpadSubtract";
	if (!zoomIn && !zoomOut) {
		return;
	}

	e.preventDefault();
	zoomFromControl(zoomIn ? scaleStep : -scaleStep);
}

function navigateText(
	start: number | undefined,
	end: number | undefined,
	file: string | undefined,
): void {
	vscode.postMessage({
		command: "navigate",
		start,
		end,
		file,
	});
}

export function subscribeRefreshButton() {
	const button = document.getElementById("refresh") as HTMLButtonElement;
	button?.addEventListener("click", function () {
		vscode.postMessage({ command: "reload" });
		button.disabled = true;
	});
}

// True when the pointer is inside the fixed toolbar strip, if the preview has one. Read at press
// time rather than cached: the strip is only as tall as its content and a preview can re-render it.
function isOverToolbar(e: MouseEvent): boolean {
	const toolbar = document.querySelector(".toolbar-outer");
	if (!toolbar) {
		return false;
	}

	const rect = toolbar.getBoundingClientRect();
	// A strip with no area covers nothing, so it can hold no press. Guarding on it also keeps the
	// point (0,0) from counting as a hit everywhere the layout has not been computed.
	if (rect.width === 0 || rect.height === 0) {
		return false;
	}

	return (
		e.clientX >= rect.left &&
		e.clientX <= rect.right &&
		e.clientY >= rect.top &&
		e.clientY <= rect.bottom
	);
}

export function initCommon(): void {
	if ((window as any).previewedFileUri) {
		setState({ uri: (window as any).previewedFileUri });
	}

	window.addEventListener("load", function () {
		// Disable selection
		document.body.style.userSelect = "none";

		// Save scroll position
		(function () {
			scrollToState();

			window.addEventListener("scroll", function () {
				const state = getState();
				state.xOffset = window.pageXOffset;
				state.yOffset = window.pageYOffset;
				vscode.setState(state);
			});
		})();

		// Drag to scroll
		(function () {
			// Dragger should be like this: <div id="dragger" style="width:100vw;height:100vh;position:fixed;left:0;top:0;"></div>
			const dragger = document.getElementById("dragger");
			if (!dragger) {
				return;
			}

			dragger.addEventListener("contextmenu", (event) =>
				event.preventDefault(),
			);

			let mdx = -1;
			let mdy = -1;
			let pressed = false;
			// Every path that starts or ends a drag goes through here, so the published signal can
			// never be left stuck on -- including the recovery below, where the button was released
			// outside the webview and no mouseup ever arrived.
			const setPressed = function (value: boolean) {
				pressed = value;
				document.body.classList.toggle("panning", value);
				if (panning$.value !== value) {
					panning$.next(value);
				}
			};

			dragger.addEventListener("mousedown", function (e) {
				// The drag layer spans the whole viewport, the toolbar strip included. The toolbar is
				// drawn over it, so a press there does not normally reach this handler -- but a
				// popup, or a preview that layers its shell differently, can put it back in the way,
				// and a mis-hit on a checkbox must never pan the view instead of toggling it.
				if (isOverToolbar(e)) {
					return;
				}
				mdx = e.pageX;
				mdy = e.pageY;
				setPressed(true);
			});

			document.body.addEventListener("mousemove", function (e) {
				if (pressed) {
					window.scroll(
						window.pageXOffset - e.pageX + mdx,
						window.pageYOffset - e.pageY + mdy,
					);
				}
			});

			document.body.addEventListener("mouseup", function () {
				setPressed(false);
			});

			document.body.addEventListener("mouseenter", function (e) {
				if (pressed && (e.buttons & 1) !== 1) {
					setPressed(false);
				}
			});
		})();

		subscribeNavigators();

		enableDropdowns();
		enableCheckboxes();

		numDropDownOpened$.subscribe((num) => {
			shouldDisableZoom = num > 0;
		});
	});
}
