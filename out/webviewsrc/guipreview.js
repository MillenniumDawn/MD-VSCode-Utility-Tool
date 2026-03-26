"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const styletable_1 = require("../src/util/styletable");
const checkbox_1 = require("./util/checkbox");
const common_1 = require("./util/common");
const existingCheckboxes = [];
let toggleVisibilityContentVisible = (0, common_1.getState)().toggleVisibilityContentVisible;
function folderChange(folder) {
    const elements = document.getElementsByClassName('containerwindow');
    (0, common_1.setState)({ folder: folder });
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        element.style.display = element.id === folder ? 'block' : 'none';
    }
    setupContainerWindowToggles(folder);
}
function setupContainerWindowToggles(folder) {
    var _a, _b, _c, _d, _e, _f, _g;
    existingCheckboxes.forEach(checkbox => checkbox.dispose());
    existingCheckboxes.length = 0;
    const containerWindowVisibilities = (_a = (0, common_1.getState)().containerWindowVisibilities) !== null && _a !== void 0 ? _a : {};
    const toggleVisibilityContentInner = document.getElementById('toggleVisibilityContentInner');
    const containerWindowName = folder.replace('containerwindow_', '');
    toggleVisibilityContentInner.innerHTML = (_c = (_b = window.containerWindowToggles[containerWindowName]) === null || _b === void 0 ? void 0 : _b.content) !== null && _c !== void 0 ? _c : '';
    const checkboxes = document.getElementsByClassName('toggleContainerWindowCheckbox');
    const toggleVisibility = document.getElementById('toggleVisibility');
    toggleVisibility.disabled = toggleVisibilityContentInner.innerHTML === '';
    if (toggleVisibility.disabled) {
        toggleVisibilityContentVisible = false;
        refreshToggleVisibilityContent();
        (0, common_1.setState)({ toggleVisibilityContentVisible });
    }
    const relatedContainerWindow = {};
    for (let i = 0; i < checkboxes.length; i++) {
        const input = checkboxes.item(i);
        let selector = '.containerwindow_' + (0, styletable_1.normalizeForStyle)(containerWindowName) + ' ';
        for (let j = 0; j <= i; j++) {
            const anotherInput = checkboxes.item(j);
            if (input.id.startsWith(anotherInput.id)) {
                selector = selector + '.childcontainerwindow_' + (0, styletable_1.normalizeForStyle)((_e = (_d = anotherInput.attributes.getNamedItem('containerWindowName')) === null || _d === void 0 ? void 0 : _d.value) !== null && _e !== void 0 ? _e : '') + ' ';
            }
        }
        relatedContainerWindow[input.id] = document.querySelector(selector);
    }
    for (let i = 0; i < checkboxes.length; i++) {
        const input = checkboxes.item(i);
        input.checked = !(input.id in containerWindowVisibilities) || containerWindowVisibilities[input.id];
        const containerWindow = relatedContainerWindow[input.id];
        if (containerWindow) {
            containerWindow.style.display = input.checked ? 'block' : 'none';
        }
        const checkbox = new checkbox_1.Checkbox(input, (_g = (_f = input.attributes.getNamedItem('containerWindowName')) === null || _f === void 0 ? void 0 : _f.value) !== null && _g !== void 0 ? _g : '');
        existingCheckboxes.push(checkbox);
        input.addEventListener('change', () => {
            containerWindowVisibilities[input.id] = input.checked;
            if (input.checked) {
                for (let i = 0; i < checkboxes.length; i++) {
                    const anotherInput = checkboxes.item(i);
                    if (anotherInput !== input && (anotherInput.id.startsWith(input.id) || input.id.startsWith(anotherInput.id))) {
                        anotherInput.checked = true;
                        containerWindowVisibilities[anotherInput.id] = true;
                    }
                }
            }
            else {
                for (let i = 0; i < checkboxes.length; i++) {
                    const anotherInput = checkboxes.item(i);
                    if (anotherInput !== input && anotherInput.id.startsWith(input.id)) {
                        anotherInput.checked = false;
                        containerWindowVisibilities[anotherInput.id] = false;
                    }
                }
            }
            (0, common_1.setState)({ containerWindowVisibilities });
            for (let i = 0; i < checkboxes.length; i++) {
                const input = checkboxes.item(i);
                const containerWindow = relatedContainerWindow[input.id];
                if (containerWindow) {
                    containerWindow.style.display = input.checked ? 'block' : 'none';
                }
            }
        });
    }
}
function refreshToggleVisibilityContent() {
    const mainContent = document.getElementById('mainContent');
    const toggleVisibilityContent = document.getElementById('toggleVisibilityContent');
    toggleVisibilityContent.style.display = toggleVisibilityContentVisible ? 'block' : 'none';
    mainContent.style.marginTop = toggleVisibilityContentVisible ? '240px' : '40px';
}
window.addEventListener('load', (0, common_1.tryRun)(function () {
    const folderSelector = document.getElementById('folderSelector');
    const folder = (0, common_1.getState)().folder || folderSelector.value;
    folderSelector.value = folder;
    folderChange(folder);
    folderSelector.addEventListener('change', function () {
        (0, common_1.setState)({ containerWindowVisibilities: {} });
        folderChange(this.value);
    });
    refreshToggleVisibilityContent();
    const toggleVisibility = document.getElementById('toggleVisibility');
    toggleVisibility.addEventListener('click', () => {
        toggleVisibilityContentVisible = !toggleVisibilityContentVisible;
        refreshToggleVisibilityContent();
        (0, common_1.setState)({ toggleVisibilityContentVisible });
    });
    (0, common_1.scrollToState)();
    (0, common_1.subscribeRefreshButton)();
}));
//# sourceMappingURL=guipreview.js.map