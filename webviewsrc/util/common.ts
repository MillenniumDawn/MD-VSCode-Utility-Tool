import { BehaviorSubject } from "rxjs";
import { enableDropdowns, numDropDownOpened$ } from "./dropdown";
import { enableCheckboxes } from "./checkbox";
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
	window.addEventListener(
		"wheel",
		function (e) {
			if (shouldDisableZoom) {
				return;
			}

			e.preventDefault();
			const oldScale = scale;

			if (e.deltaY > 0) {
				scale = Math.max(0.2, scale - 0.2);
			} else if (e.deltaY < 0) {
				scale = Math.min(1, scale + 0.2);
			}

			const oldScrollX = window.scrollX;
			const oldScrollY = window.scrollY;

			contentElement.style.transform = `scale(${scale})`;
			setState({ scale });

			const nextScrollX =
				((e.pageX - xOffset) * scale) / oldScale +
				xOffset -
				(e.pageX - oldScrollX);
			const nextScrollY =
				((e.pageY - yOffset) * scale) / oldScale +
				yOffset -
				(e.pageY - oldScrollY);
			window.scrollTo(nextScrollX, nextScrollY);
		},
		{
			passive: false,
		},
	);
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
