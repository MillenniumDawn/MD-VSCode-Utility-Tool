"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./util/common");
function filterChange(text) {
    text = text.toLowerCase();
    const elements = document.getElementsByClassName('spriteTypePreview');
    (0, common_1.setState)({ filter: text });
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        element.style.display = (text.length === 0 || element.id.toLowerCase().includes(text)) ? 'inline-block' : 'none';
    }
}
window.addEventListener('load', (0, common_1.tryRun)(function () {
    const filter = (0, common_1.getState)().filter || '';
    const element = document.getElementById('filter');
    element.value = filter;
    filterChange(filter);
    const changeFunc = function () {
        filterChange(this.value);
    };
    element.addEventListener('change', changeFunc);
    element.addEventListener('keypress', changeFunc);
    element.addEventListener('keyup', changeFunc);
    element.addEventListener('paste', changeFunc);
    element.addEventListener('cut', changeFunc);
}));
//# sourceMappingURL=gfx.js.map