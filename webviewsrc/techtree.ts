import { setState, getState, scrollToState, tryRun, subscribeRefreshButton, subscribeNavigators, enableZoom, initCommon } from "./util/common";
import { vscode } from "./util/vscode";

initCommon();

function folderChange(folder: string) {
    const elements = document.getElementsByClassName('techfolder');
    setState({ folder: folder });

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLDivElement;
        element.style.display = element.id === folder ? 'block' : 'none';
    }
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

    enableZoom(contentElement, 0, 40);
}));
