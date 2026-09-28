// A window the host rendered at the size the game draws it, scaled down into a frame no wider than
// `maxWidth`. A transform rather than a zoom, so the sprites inside keep their own positioning. The
// host wraps the window in an element carrying its size as inline width and height.
export function buildGuiFrame(html: string, maxWidth: number, className: string): HTMLDivElement {
	const frame = document.createElement("div");
	frame.className = className;
	frame.innerHTML = html;

	const inner = frame.firstElementChild as HTMLElement | null;
	const width = parseInt(inner?.style.width ?? "0", 10);
	const height = parseInt(inner?.style.height ?? "0", 10);
	if (inner && width > 0) {
		const scale = Math.min(1, maxWidth / width);
		inner.style.transform = `scale(${scale})`;
		inner.style.transformOrigin = "top left";
		frame.style.width = Math.round(width * scale) + "px";
		frame.style.height = Math.round(height * scale) + "px";
	}

	return frame;
}
