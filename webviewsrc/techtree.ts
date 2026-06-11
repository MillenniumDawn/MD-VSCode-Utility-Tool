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

    // Live toggle between raw tech id (default) and localised tech name. Unchecked shows the
    // raw id; checking the box adds the "show-tech-loc" class to reveal the localised name.
    // The persisted webview state overrides the default so the choice survives folder switches
    // and reloads. When the localisation index is off, checking the box has no real effect
    // (the id is shown regardless), so we surface a warning next to the checkbox.
    const showTechLoc = document.getElementById('show-tech-loc') as HTMLInputElement | null;
    if (showTechLoc) {
        const warning = document.getElementById('show-loc-warning');
        const localisationIndex = showTechLoc.dataset.localisationIndex === 'true';
        const updateWarning = (checked: boolean) => {
            if (warning) {
                warning.style.display = checked && !localisationIndex ? 'inline' : 'none';
            }
        };

        const initial = getState().showLoc ?? showTechLoc.checked;
        showTechLoc.checked = initial;
        contentElement.classList.toggle('show-tech-loc', initial);
        updateWarning(initial);
        showTechLoc.addEventListener('change', function() {
            setState({ showLoc: this.checked });
            contentElement.classList.toggle('show-tech-loc', this.checked);
            updateWarning(this.checked);
        });
    }

    enableZoom(contentElement, 0, 40);
}));
