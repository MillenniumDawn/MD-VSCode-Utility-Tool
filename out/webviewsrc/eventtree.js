"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const common_1 = require("./util/common");
window.addEventListener('load', (0, common_1.tryRun)(function () {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        // Zoom
        const contentElement = document.getElementById('eventtreecontent');
        (0, common_1.enableZoom)(contentElement, 0, 0);
        showPictureWhenHover();
    });
}));
function showPictureWhenHover() {
    const eventNodes = document.getElementsByClassName('event-picture-host');
    for (let i = 0; i < eventNodes.length; i++) {
        const eventNode = eventNodes.item(i);
        if (eventNode) {
            showPictureWhenHoverElement(eventNode);
        }
    }
}
function showPictureWhenHoverElement(eventNode) {
    var _a, _b;
    const pictureKey = (_a = eventNode.attributes.getNamedItem('picture-style-key')) === null || _a === void 0 ? void 0 : _a.value;
    const pictureWidthStr = (_b = eventNode.attributes.getNamedItem('picture-width')) === null || _b === void 0 ? void 0 : _b.value;
    if (!pictureKey || !pictureWidthStr) {
        return;
    }
    const pictureWidth = parseInt(pictureWidthStr);
    let hoverElement = undefined;
    eventNode.addEventListener('mouseenter', () => {
        const position = eventNode.getBoundingClientRect();
        hoverElement = document.createElement('div');
        hoverElement.className = pictureKey;
        hoverElement.style.position = 'absolute';
        hoverElement.style.left = (position.left + window.scrollX - (pictureWidth - position.width) / 2) + 'px';
        hoverElement.style.top = (position.top + position.height + window.scrollY) + 'px';
        document.body.append(hoverElement);
    });
    eventNode.addEventListener('mouseleave', () => {
        hoverElement === null || hoverElement === void 0 ? void 0 : hoverElement.remove();
    });
}
//# sourceMappingURL=eventtree.js.map