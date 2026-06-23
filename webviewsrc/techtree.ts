import { setState, getState, scrollToState, tryRun, subscribeRefreshButton, enableZoom, initCommon } from "./util/common";

initCommon();

function folderChange(folder: string) {
    const elements = document.getElementsByClassName('techfolder');
    setState({ folder: folder });

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLDivElement;
        element.style.display = element.id === folder ? 'block' : 'none';
    }
}

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

    // Live name-mode switch. Each mode maps to a "name-mode-<value>" class on #techtreecontent
    // that reveals the matching name variant; the default is "id" (raw token). The persisted
    // webview state overrides the default so the choice survives folder switches and reloads.
    // When the localisation index is off, only the id resolves, so any non-id mode surfaces a
    // warning next to the dropdown.
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
