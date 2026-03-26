"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeRefreshButton = exports.enableZoom = exports.tryRun = exports.subscribeNavigators = exports.copyArray = exports.scrollToState = exports.getState = exports.setState = exports.arrayToMap = void 0;
const dropdown_1 = require("./dropdown");
const checkbox_1 = require("./checkbox");
const vscode_1 = require("./vscode");
const telemetry_1 = require("./telemetry");
const common_1 = require("../../src/util/common");
var common_2 = require("../../src/util/common");
Object.defineProperty(exports, "arrayToMap", { enumerable: true, get: function () { return common_2.arrayToMap; } });
function setState(obj) {
    const state = getState();
    Object.assign(state, obj);
    vscode_1.vscode.setState(state);
}
exports.setState = setState;
function getState() {
    return vscode_1.vscode.getState() || {};
}
exports.getState = getState;
function scrollToState() {
    const state = getState();
    const xOffset = state.xOffset || 0;
    const yOffset = state.yOffset || 0;
    window.scroll(xOffset, yOffset);
}
exports.scrollToState = scrollToState;
function copyArray(src, dst, offsetSrc, offsetDst, length) {
    for (let i = offsetSrc, j = offsetDst, k = 0; k < length; i++, j++, k++) {
        dst[j] = src[i];
    }
}
exports.copyArray = copyArray;
function subscribeNavigators() {
    const navigators = document.getElementsByClassName("navigator");
    for (let i = 0; i < navigators.length; i++) {
        const navigator = navigators[i];
        navigator.addEventListener('click', function (e) {
            var _a, _b, _c;
            e.stopPropagation();
            const startStr = (_a = this.attributes.getNamedItem('start')) === null || _a === void 0 ? void 0 : _a.value;
            const endStr = (_b = this.attributes.getNamedItem('end')) === null || _b === void 0 ? void 0 : _b.value;
            const file = (_c = this.attributes.getNamedItem('file')) === null || _c === void 0 ? void 0 : _c.value;
            const start = !startStr || startStr === 'undefined' ? undefined : parseInt(startStr);
            const end = !endStr ? undefined : parseInt(endStr);
            navigateText(start, end, file);
        });
    }
}
exports.subscribeNavigators = subscribeNavigators;
function tryRun(func) {
    return function (...args) {
        try {
            const result = func.apply(this, args);
            if (result instanceof Promise) {
                return result.catch(e => {
                    console.error(e);
                    (0, telemetry_1.sendException)((0, common_1.forceError)(e));
                });
            }
            return result;
        }
        catch (e) {
            console.error(e);
            (0, telemetry_1.sendException)((0, common_1.forceError)(e));
        }
        return undefined;
    };
}
exports.tryRun = tryRun;
let shouldDisableZoom = false;
function enableZoom(contentElement, xOffset, yOffset) {
    let scale = getState().scale || 1;
    contentElement.style.transform = `scale(${scale})`;
    contentElement.style.transformOrigin = '0 0';
    window.addEventListener('wheel', function (e) {
        if (shouldDisableZoom) {
            return;
        }
        e.preventDefault();
        const oldScale = scale;
        if (e.deltaY > 0) {
            scale = Math.max(0.2, scale - 0.2);
        }
        else if (e.deltaY < 0) {
            scale = Math.min(1, scale + 0.2);
        }
        const oldScrollX = window.scrollX;
        const oldScrollY = window.scrollY;
        contentElement.style.transform = `scale(${scale})`;
        setState({ scale });
        const nextScrollX = (e.pageX - xOffset) * scale / oldScale + xOffset - (e.pageX - oldScrollX);
        const nextScrollY = (e.pageY - yOffset) * scale / oldScale + yOffset - (e.pageY - oldScrollY);
        window.scrollTo(nextScrollX, nextScrollY);
    }, {
        passive: false
    });
}
exports.enableZoom = enableZoom;
function navigateText(start, end, file) {
    vscode_1.vscode.postMessage({
        command: 'navigate',
        start,
        end,
        file,
    });
}
;
function subscribeRefreshButton() {
    const button = document.getElementById('refresh');
    button === null || button === void 0 ? void 0 : button.addEventListener('click', function () {
        vscode_1.vscode.postMessage({ command: 'reload' });
        button.disabled = true;
    });
}
exports.subscribeRefreshButton = subscribeRefreshButton;
if (window.previewedFileUri) {
    setState({ uri: window.previewedFileUri });
}
window.addEventListener('load', function () {
    // Disable selection
    document.body.style.userSelect = 'none';
    // Save scroll position
    (function () {
        scrollToState();
        window.addEventListener('scroll', function () {
            const state = getState();
            state.xOffset = window.pageXOffset;
            state.yOffset = window.pageYOffset;
            vscode_1.vscode.setState(state);
        });
    })();
    // Drag to scroll
    (function () {
        // Dragger should be like this: <div id="dragger" style="width:100vw;height:100vh;position:fixed;left:0;top:0;"></div>
        const dragger = document.getElementById("dragger");
        if (!dragger) {
            return;
        }
        dragger.addEventListener('contextmenu', event => event.preventDefault());
        let mdx = -1;
        let mdy = -1;
        let pressed = false;
        dragger.addEventListener('mousedown', function (e) {
            mdx = e.pageX;
            mdy = e.pageY;
            pressed = true;
        });
        document.body.addEventListener('mousemove', function (e) {
            if (pressed) {
                window.scroll(window.pageXOffset - e.pageX + mdx, window.pageYOffset - e.pageY + mdy);
            }
        });
        document.body.addEventListener('mouseup', function () {
            pressed = false;
        });
        document.body.addEventListener('mouseenter', function (e) {
            if (pressed && (e.buttons & 1) !== 1) {
                pressed = false;
            }
        });
    })();
    subscribeNavigators();
    (0, dropdown_1.enableDropdowns)();
    (0, checkbox_1.enableCheckboxes)();
    dropdown_1.numDropDownOpened$.subscribe(num => {
        shouldDisableZoom = num > 0;
    });
});
//# sourceMappingURL=common.js.map