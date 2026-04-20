"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./util/common");
window.addEventListener('load', (0, common_1.tryRun)(async function () {
    // Zoom
    const contentElement = document.getElementById('eventtreecontent');
    (0, common_1.enableZoom)(contentElement, 0, 0);
    showPictureWhenHover();
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
    const pictureKey = eventNode.attributes.getNamedItem('picture-style-key')?.value;
    const pictureWidthStr = eventNode.attributes.getNamedItem('picture-width')?.value;
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
        hoverElement?.remove();
    });
}
//# sourceMappingURL=eventtree.js.map