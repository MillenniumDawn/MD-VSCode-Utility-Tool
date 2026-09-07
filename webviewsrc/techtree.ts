import { setState, getState, scrollToState, tryRun, subscribeRefreshButton, subscribeNavigators, enableZoom, initCommon } from "./util/common";
import { vscode } from "./util/vscode";

initCommon();

interface CountryOption {
    tag: string;
    label: string;
}

// Which countries have their own technology icons, per technology folder, and which one the reader
// picked. Both are rendered on the host: it owns the tree markup, so it is what redraws when the
// country changes, and this side only has to keep the dropdown in step with the folder on screen.
// They stay on window rather than being copied into module state, so an in-place update -- and the
// re-render the host sends back after a country change -- has one place to write, the way miopreview
// keeps window.mios.
function countriesByFolder(): Record<string, CountryOption[]> {
    return (window as any).techCountries ?? {};
}

function selectedCountry(): string {
    return (window as any).techCountry ?? '';
}

function folderChange(folder: string) {
    const elements = document.getElementsByClassName('techfolder');
    setState({ folder: folder });

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLDivElement;
        element.style.display = element.id === folder ? 'block' : 'none';
    }

    updateCountryOptions(folder);
}

// Re-lists the country dropdown for the folder now on screen: only the countries that have their own
// icons for a technology drawn there are worth offering. The selected country stays listed even when
// this folder has no art for it, so switching folders never silently changes what the host renders.
function updateCountryOptions(folder: string) {
    const select = document.getElementById('tech-country') as HTMLSelectElement | null;
    if (!select) {
        return;
    }

    const selected = selectedCountry();
    const options = countriesByFolder()[folder.replace(/^techfolder_/, '')] ?? [];
    const listed = options.some(o => o.tag === selected);
    const all = selected !== '' && !listed
        ? [...options, { tag: selected, label: labelForTag(selected) }]
        : options;

    while (select.options.length > 1) {
        select.remove(1);
    }
    for (const option of all) {
        const element = document.createElement('option');
        element.value = option.tag;
        element.textContent = option.label;
        select.appendChild(element);
    }

    select.value = selected;
}

// The label the host resolved for a tag, wherever it appears; the bare tag when no folder lists it.
function labelForTag(tag: string): string {
    const countries = countriesByFolder();
    for (const folder of Object.keys(countries)) {
        const option = (countries[folder] ?? []).find(o => o.tag === tag);
        if (option) {
            return option.label;
        }
    }

    return tag;
}

// In-place update pushed by LoaderPreview when the previewed file changed: refresh the server-rendered
// tree markup and folder options without a full reload, so scroll, zoom and the selected folder / name
// mode survive. The tree is rendered on the host, so the payload carries HTML (contentHtml, the folder
// <option> list), not data globals. The folder selector and name-mode dropdowns live in the fixed
// toolbar OUTSIDE #techtreecontent, so their load-time change listeners are untouched and never rebind;
// only #techtreecontent's inner markup is replaced. Falls back to a full reload if the DOM the swap
// needs is gone (e.g. the webview shows the "no technology tree" / error page, which has no listener).
window.addEventListener('message', tryRun(function(event: MessageEvent) {
    const msg = event.data;
    if (!msg || msg.type !== 'updateBody') {
        return;
    }

    const contentElement = document.getElementById('techtreecontent') as HTMLDivElement | null;
    const folderSelect = document.getElementById('folderSelector') as HTMLSelectElement | null;
    if (!contentElement || !folderSelect) {
        vscode.postMessage({ command: 'reload' });
        return;
    }

    if (typeof msg.styleCss === 'string') {
        const serverStyles = document.getElementById('tech-server-styles');
        if (serverStyles) {
            serverStyles.textContent = msg.styleCss;
        }
    }

    const data = msg.data ?? {};
    const folders: string[] = Array.isArray(data.folders) ? data.folders : [];

    // Before any folderChange below, so the re-list it does sees the new lists: an edit can add a
    // technology whose country has art, or move one out of a folder.
    if (data.countries) {
        (window as any).techCountries = data.countries;
    }

    // Refresh the folder <option> list and keep the current selection if that folder still exists;
    // otherwise fall back to the persisted folder, then the first option. The <select> element and
    // its change listener are untouched, so nothing rebinds.
    const validValues = folders.map(f => `techfolder_${f}`);
    const previous = folderSelect.value;
    if (typeof data.folderOptionsHtml === 'string') {
        folderSelect.innerHTML = data.folderOptionsHtml;
    }
    let target = previous;
    if (!validValues.includes(target)) {
        const stateFolder = getState().folder;
        target = stateFolder && validValues.includes(stateFolder) ? stateFolder : (validValues[0] ?? '');
    }
    folderSelect.value = target;
    // The folder may not have moved, in which case neither branch below calls folderChange, and the
    // country lists still have to catch up with the ones this message carried.
    updateCountryOptions(target);

    // Swap the INNER markup only. enableZoom captured this same element and holds the zoom on its
    // transform: scale(); the name-mode-* class also lives on the element (not its children). Both
    // survive because the element itself is not replaced. The .techfolder children are fresh, so
    // folderChange must re-apply block/none, and the fresh .navigator nodes need their click handlers.
    // Guard the swap and rebind on contentHtml so a styleCss-only message never double-binds; still
    // run folderChange (which persists the selection via setState) when the folder fell back.
    if (typeof data.contentHtml === 'string') {
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        contentElement.innerHTML = data.contentHtml;
        folderChange(target);
        subscribeNavigators();
        window.scrollTo(scrollX, scrollY);
    } else if (target !== previous) {
        folderChange(target);
    }
}));

window.addEventListener('load', tryRun(function() {
    const element = document.getElementById('folderSelector') as HTMLSelectElement;
    const folder = getState().folder || element.value;
    element.value = folder;
    folderChange(folder);
    scrollToState();

    subscribeRefreshButton();

    element.addEventListener('change', function() {
        folderChange(this.value);
    });

    const contentElement = document.getElementById('techtreecontent') as HTMLDivElement;

    // Applies the selected name-mode as a "name-mode-<value>" class on #techtreecontent, persisted across reloads.
    const nameMode = document.getElementById('tech-name-mode') as HTMLSelectElement | null;
    if (nameMode) {
        const warning = document.getElementById('show-loc-warning');
        const localisationIndex = nameMode.dataset.localisationIndex === 'true';
        const modes = ['id', 'short', 'long', 'techname'];
        const applyMode = (mode: string) => {
            for (const m of modes) {
                contentElement.classList.toggle(`name-mode-${m}`, m === mode);
            }
            if (warning) {
                warning.style.display = mode !== 'id' && !localisationIndex ? 'inline' : 'none';
            }
        };

        const initial = getState().nameMode ?? 'id';
        nameMode.value = initial;
        applyMode(initial);
        nameMode.addEventListener('change', function() {
            setState({ nameMode: this.value });
            applyMode(this.value);
        });
    }

    // Lives in the fixed toolbar, outside #techtreecontent, so the in-place swap never replaces it and
    // this listener is bound exactly once. The host redraws the tree with the chosen country's icons.
    const country = document.getElementById('tech-country') as HTMLSelectElement | null;
    if (country) {
        country.addEventListener('change', function() {
            (window as any).techCountry = this.value;
            vscode.postMessage({ command: 'setPreviewOption', key: 'technology.country', value: this.value });
        });
    }

    enableZoom(contentElement, 0, 40);
}));
