"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./util/common");
function folderChange(folder) {
    const elements = document.getElementsByClassName('techfolder');
    (0, common_1.setState)({ folder: folder });
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        element.style.display = element.id === folder ? 'block' : 'none';
    }
}
window.addEventListener('load', (0, common_1.tryRun)(function () {
    const element = document.getElementById('folderSelector');
    const folder = (0, common_1.getState)().folder || element.value;
    element.value = folder;
    folderChange(folder);
    (0, common_1.scrollToState)();
    (0, common_1.subscribeRefreshButton)();
    element.addEventListener('change', function () {
        folderChange(this.value);
    });
}));
//# sourceMappingURL=techtree.js.map