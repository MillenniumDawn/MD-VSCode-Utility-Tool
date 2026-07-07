import { tryRun, subscribeNavigators, enableZoom, initCommon } from "./util/common";
import { vscode } from "./util/vscode";

initCommon();

// Marker on every hover-picture popup (appended to body, outside #eventtreecontent) so an in-place
// update can sweep any that were stranded by replacing their host node mid-hover.
const hoverPictureClass = 'event-hover-picture';

// In-place update pushed by LoaderPreview when the previewed file changed: refresh the server-rendered
// tree markup without a full reload, so scroll and zoom survive. The tree is rendered on the host, so
// the payload carries HTML (contentHtml). Only #eventtreecontent's inner markup is replaced. Falls back
// to a full reload if the DOM the swap needs is gone (e.g. the webview shows the error page, which has
// no listener).
window.addEventListener('message', tryRun(function(event: MessageEvent) {
    const msg = event.data;
    if (!msg || msg.type !== 'updateBody') {
        return;
    }

    const contentElement = document.getElementById('eventtreecontent') as HTMLDivElement | null;
    if (!contentElement) {
        vscode.postMessage({ command: 'reload' });
        return;
    }

    if (typeof msg.styleCss === 'string') {
        const serverStyles = document.getElementById('event-server-styles');
        if (serverStyles) {
            serverStyles.textContent = msg.styleCss;
        }
    }

    // Swap the INNER markup only. enableZoom captured this same element and holds the zoom on its
    // transform: scale(); the element itself is not replaced, so the zoom survives. The fresh nodes
    // need their hover-picture and .navigator click handlers re-bound (both were bound on the now-
    // replaced children). Guard the swap and rebind on contentHtml so a styleCss-only message never
    // double-binds listeners on the surviving nodes.
    const data = msg.data ?? {};
    if (typeof data.contentHtml === 'string') {
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        // Replacing the inner markup orphans any node currently being hovered, so its mouseleave never
        // fires and its popup (parented to body) would be left stranded. Sweep them before the swap.
        document.querySelectorAll('.' + hoverPictureClass).forEach(el => el.remove());
        contentElement.innerHTML = data.contentHtml;
        showPictureWhenHover();
        subscribeNavigators();
        window.scrollTo(scrollX, scrollY);
    }
}));

window.addEventListener('load', tryRun(async function() {
    // Zoom
    const contentElement = document.getElementById('eventtreecontent') as HTMLDivElement;
    enableZoom(contentElement, 0, 0);

    showPictureWhenHover();
}));

function showPictureWhenHover() {
    const eventNodes = document.getElementsByClassName('event-picture-host') as HTMLCollectionOf<HTMLDivElement>;
    for (let i = 0; i < eventNodes.length; i++) {
        const eventNode = eventNodes.item(i);
        if (eventNode) {
            showPictureWhenHoverElement(eventNode);
        }
    }
}

function showPictureWhenHoverElement(eventNode: HTMLDivElement) {
    const pictureKey = eventNode.attributes.getNamedItem('picture-style-key')?.value;
    const pictureWidthStr = eventNode.attributes.getNamedItem('picture-width')?.value;
    if (!pictureKey || !pictureWidthStr) {
        return;
    }

    const pictureWidth = parseInt(pictureWidthStr);

    let hoverElement: HTMLDivElement | undefined = undefined;

    eventNode.addEventListener('mouseenter', () => {
        const position = eventNode.getBoundingClientRect();
        hoverElement = document.createElement('div');
        hoverElement.className = pictureKey + ' ' + hoverPictureClass;
        hoverElement.style.position = 'absolute';
        hoverElement.style.left = (position.left + window.scrollX - (pictureWidth - position.width) / 2) + 'px';
        hoverElement.style.top = (position.top + position.height + window.scrollY) + 'px';
        document.body.append(hoverElement);
    });

    eventNode.addEventListener('mouseleave', () => {
        hoverElement?.remove();
    });
}
