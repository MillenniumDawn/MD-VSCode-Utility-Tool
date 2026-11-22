import { vscode } from "./util/vscode";

// The page of the Focus Icon Catalog. The host sends every icon's name first; a tile asks for its
// picture when it scrolls into view, so a mod with thousands of icons opens at once. A click asks the
// host to copy the name, because a webview cannot reach the clipboard reliably on its own.

interface CatalogIcon {
	name: string;
	gfxFile: string;
	texture: string;
	source: "mod" | "parent" | "vanilla";
	shine: boolean;
}

interface CatalogData {
	icons: CatalogIcon[];
	gfxFiles: { path: string; source: string; count: number }[];
}

interface CatalogStrings {
	copied: string;
	count: string;
	empty: string;
	loading: string;
	failed: string;
}

interface Filters {
	search: string;
	source: string;
	file: string;
	hideShine: boolean;
}

const strings: CatalogStrings = (window as any).focusIconCatalogStrings ?? {
	copied: "Copied {0}",
	count: "{0} of {1} icons",
	empty: "No focus icons found.",
	loading: "Loading focus icons...",
	failed: "Cannot load the focus icons: {0}",
};

function fill(template: string, ...values: (string | number)[]): string {
	return template.replace(/\{(\d+)\}/g, (match, index) => {
		const value = values[Number(index)];
		return value === undefined ? match : String(value);
	});
}

const tiles = new Map<string, HTMLElement>();
const requested = new Set<string>();
let pending = new Set<string>();
let flushTimer: number | undefined;
let icons: CatalogIcon[] = [];
let observer: IntersectionObserver | undefined;
let toastTimer: number | undefined;

function savedFilters(): Filters {
	const state = vscode.getState() ?? {};
	return {
		search: typeof state.search === "string" ? state.search : "",
		source: typeof state.source === "string" ? state.source : "all",
		file: typeof state.file === "string" ? state.file : "",
		hideShine: typeof state.hideShine === "boolean" ? state.hideShine : true,
	};
}

function element<T extends HTMLElement>(id: string): T {
	return document.getElementById(id) as T;
}

function currentFilters(): Filters {
	return {
		search: element<HTMLInputElement>("catalog-search").value,
		source: element<HTMLSelectElement>("catalog-source").value,
		file: element<HTMLSelectElement>("catalog-file").value,
		hideShine: element<HTMLInputElement>("catalog-shine").checked,
	};
}

export function matches(icon: CatalogIcon, filters: Filters): boolean {
	if (filters.hideShine && icon.shine) {
		return false;
	}
	if (filters.source !== "all" && icon.source !== filters.source) {
		return false;
	}
	if (filters.file !== "" && icon.gfxFile !== filters.file) {
		return false;
	}
	const search = filters.search.trim().toLowerCase();
	return search === "" || icon.name.toLowerCase().includes(search);
}

function applyFilters(): void {
	const filters = currentFilters();
	vscode.setState({ ...(vscode.getState() ?? {}), ...filters });
	let shown = 0;
	for (const icon of icons) {
		const tile = tiles.get(icon.name);
		if (!tile) {
			continue;
		}
		const visible = matches(icon, filters);
		tile.hidden = !visible;
		if (visible) {
			shown++;
		}
	}
	element("catalog-count").textContent = fill(strings.count, shown, icons.length);
}

function requestImage(name: string): void {
	if (requested.has(name)) {
		return;
	}
	requested.add(name);
	pending.add(name);
	if (flushTimer === undefined) {
		flushTimer = window.setTimeout(flushRequests, 30);
	}
}

function flushRequests(): void {
	flushTimer = undefined;
	const names = [...pending];
	pending = new Set();
	for (let i = 0; i < names.length; i += 64) {
		vscode.postMessage({ command: "requestImages", names: names.slice(i, i + 64) });
	}
}

function showToast(text: string): void {
	const toast = element("catalog-toast");
	toast.textContent = text;
	toast.classList.add("visible");
	if (toastTimer !== undefined) {
		window.clearTimeout(toastTimer);
	}
	toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1500);
}

function activate(tile: HTMLElement, name: string, openDefinition: boolean): void {
	if (openDefinition) {
		vscode.postMessage({ command: "openDefinition", name });
		return;
	}
	vscode.postMessage({ command: "copyName", name });
	tile.classList.add("copied");
	window.setTimeout(() => tile.classList.remove("copied"), 800);
	showToast(fill(strings.copied, name));
}

function createTile(icon: CatalogIcon): HTMLElement {
	const tile = document.createElement("div");
	tile.className = "catalog-tile";
	tile.tabIndex = 0;
	tile.setAttribute("role", "button");
	tile.dataset.name = icon.name;
	tile.title = `${icon.name}\n${icon.gfxFile}\n${icon.texture}`;

	const image = document.createElement("div");
	image.className = "catalog-image";
	const label = document.createElement("div");
	label.className = "catalog-name";
	label.textContent = icon.name;
	tile.append(image, label);

	tile.addEventListener("click", e => activate(tile, icon.name, e.ctrlKey || e.metaKey));
	tile.addEventListener("keydown", e => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			activate(tile, icon.name, e.ctrlKey || e.metaKey);
		}
	});
	return tile;
}

function renderCatalog(data: CatalogData): void {
	icons = data.icons;
	tiles.clear();
	requested.clear();
	pending.clear();
	observer?.disconnect();
	observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				const name = (entry.target as HTMLElement).dataset.name;
				if (name) {
					requestImage(name);
				}
				observer?.unobserve(entry.target);
			}
		}
	}, { rootMargin: "400px" });

	const fileSelect = element<HTMLSelectElement>("catalog-file");
	const selectedFile = savedFilters().file;
	while (fileSelect.options.length > 1) {
		fileSelect.remove(1);
	}
	for (const file of data.gfxFiles) {
		const option = document.createElement("option");
		option.value = file.path;
		option.textContent = `${file.path} (${file.count})`;
		fileSelect.add(option);
	}
	fileSelect.value = data.gfxFiles.some(f => f.path === selectedFile) ? selectedFile : "";

	const grid = element("catalog-grid");
	const fragment = document.createDocumentFragment();
	for (const icon of icons) {
		const tile = createTile(icon);
		tiles.set(icon.name, tile);
		fragment.append(tile);
	}
	grid.replaceChildren(fragment);
	for (const [name, tile] of tiles) {
		if (observer) {
			observer.observe(tile);
		} else {
			requestImage(name);
		}
	}

	element("catalog-status").textContent = icons.length === 0 ? strings.empty : "";
	element<HTMLButtonElement>("refresh").disabled = false;
	applyFilters();
}

function showImages(images: Record<string, string | null>): void {
	for (const [name, uri] of Object.entries(images)) {
		const holder = tiles.get(name)?.querySelector(".catalog-image");
		if (!holder) {
			continue;
		}
		holder.replaceChildren();
		if (typeof uri === "string") {
			const img = document.createElement("img");
			img.src = uri;
			img.alt = name;
			holder.classList.remove("missing");
			holder.append(img);
		} else {
			holder.classList.add("missing");
		}
	}
}

window.addEventListener("message", event => {
	const message = event.data;
	if (message?.type === "catalog") {
		renderCatalog(message.data as CatalogData);
	} else if (message?.type === "images") {
		showImages(message.images ?? {});
	} else if (message?.type === "catalogError") {
		element("catalog-status").textContent = fill(strings.failed, String(message.message ?? ""));
		element<HTMLButtonElement>("refresh").disabled = false;
	}
});

window.addEventListener("load", () => {
	const filters = savedFilters();
	element<HTMLInputElement>("catalog-search").value = filters.search;
	element<HTMLSelectElement>("catalog-source").value = filters.source;
	element<HTMLInputElement>("catalog-shine").checked = filters.hideShine;
	element("catalog-status").textContent = strings.loading;

	element("catalog-search").addEventListener("input", applyFilters);
	element("catalog-source").addEventListener("change", applyFilters);
	element("catalog-file").addEventListener("change", applyFilters);
	element("catalog-shine").addEventListener("change", applyFilters);
	element("refresh").addEventListener("click", () => {
		element<HTMLButtonElement>("refresh").disabled = true;
		element("catalog-status").textContent = strings.loading;
		vscode.postMessage({ command: "reload" });
	});

	vscode.postMessage({ command: "ready" });
});
