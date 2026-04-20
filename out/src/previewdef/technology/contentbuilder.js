"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTechnologyFile = renderTechnologyFile;
const i18n_1 = require("../../util/i18n");
const imagecache_1 = require("../../util/image/imagecache");
const common_1 = require("../../util/common");
const containerwindow_1 = require("../../util/hoi4gui/containerwindow");
const gridbox_1 = require("../../util/hoi4gui/gridbox");
const instanttextbox_1 = require("../../util/hoi4gui/instanttextbox");
const icon_1 = require("../../util/hoi4gui/icon");
const html_1 = require("../../util/html");
const loader_1 = require("../../util/loader/loader");
const debug_1 = require("../../util/debug");
const lodash_1 = require("lodash");
const styletable_1 = require("../../util/styletable");
const localisationIndex_1 = require("../../util/localisationIndex");
const featureflags_1 = require("../../util/featureflags");
const techTreeViewName = 'countrytechtreeview';
const doctrineTreeViewName = 'countrydoctrineview';
async function renderTechnologyFile(loader, uri, webview) {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
    try {
        const session = new loader_1.LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from(session.loadedLoader).map(v => v.toString());
        (0, debug_1.debug)('Loader session tech tree', loadedLoaders);
        const technologyTrees = loadResult.result.technologyTrees;
        const folders = (0, lodash_1.uniq)(technologyTrees.map(tt => tt.folder));
        if (folders.length === 0) {
            const baseContent = (0, i18n_1.localize)('techtree.notechtree', 'No technology tree.');
            return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
        }
        const styleTable = new styletable_1.StyleTable();
        const baseContent = await renderTechnologyFolders(technologyTrees, folders, styleTable, loadResult.result);
        return (0, html_1.html)(webview, baseContent, [
            setPreviewFileUriScript,
            'common.js',
            'techtree.js',
        ], [
            'common.css',
            'codicon.css',
            styleTable,
        ]);
    }
    catch (e) {
        const baseContent = `${(0, i18n_1.localize)('error', 'Error')}: <br/>  <pre>${(0, html_1.htmlEscape)((0, common_1.forceError)(e).toString())}</pre>`;
        return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
    }
}
async function renderTechnologyFolders(technologyTrees, folders, styleTable, loadResult) {
    const guiFiles = loadResult.guiFiles.map(f => f.file);
    const guiTypes = (0, lodash_1.flatMap)(loadResult.guiFiles, f => f.data.guitypes);
    const containerWindowTypes = (0, lodash_1.flatMap)(guiTypes, t => t.containerwindowtype);
    const techTreeViews = containerWindowTypes.filter(c => c.name?.toLowerCase() === techTreeViewName || c.name?.toLowerCase() === doctrineTreeViewName);
    if (techTreeViews.length === 0) {
        throw new common_1.UserError((0, i18n_1.localize)('techtree.cantfindviewin', "Can't find {0} in {1}.", techTreeViewName + "," + doctrineTreeViewName, guiFiles));
    }
    const gfxFiles = loadResult.gfxFiles;
    const techFolders = (await Promise.all(folders.map(folder => renderTechnologyFolder(technologyTrees, folder, techTreeViews, containerWindowTypes, styleTable, guiFiles, gfxFiles)))).join('');
    return `
    ${await renderFolderSelector(folders, styleTable)}
    <div
    id="dragger"
    class="${styleTable.oneTimeStyle('dragger', () => `
        width: 100vw;
        height: 100vh;
        position: fixed;
        left:0;
        top:0;
        background:#101010;
    `)}">
    </div>
    <div
    id="techtreecontent"
    class="${styleTable.oneTimeStyle('mainContent', () => `
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: none;
        margin-top: 40px;
    `)}">
        ${techFolders}
    </div>`;
}
async function renderFolderSelector(folders, styleTable) {
    const folderOptions = await Promise.all(folders.map(async (folder) => {
        const localizedText = featureflags_1.localisationIndex ? `${await (0, localisationIndex_1.getLocalisedTextQuick)(folder)} (${folder})` : folder;
        return `<option value="techfolder_${folder}">${localizedText}</option>`;
    }));
    return `<div
    class="${styleTable.oneTimeStyle('folderSelectorBar', () => `
        position: fixed;
        padding-top: 10px;
        padding-left: 20px;
        width: 100%;
        height: 30px;
        top: 0;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        z-index: 10;
    `)}">
        <label for="folderSelector" class="${styleTable.oneTimeStyle('folderSelectorLabel', () => `margin-right:5px`)}">
            ${(0, i18n_1.localize)('techtree.techfolder', 'Technology folder: ')}
        </label>
        <div class="select-container">
            <select
                id="folderSelector"
                type="text"
                class="${styleTable.oneTimeStyle('folderSelector', () => `min-width:200px`)}"
            >
                ${folderOptions.join('')}
            </select>
        </div>
    </div>`;
}
async function renderTechnologyFolder(technologyTrees, folder, techTreeViews, allContainerWindowTypes, styleTable, guiFiles, gfxFiles) {
    const folderTreeView = (0, lodash_1.flatMap)(techTreeViews, tv => tv.containerwindowtype).find(c => c.name === folder);
    let children;
    if (!folderTreeView) {
        children = `<div>${(0, i18n_1.localize)('techtree.cantfindtechfolderin', "Can't find technology folder {0} in {1}.", folder, guiFiles)}</div>`;
    }
    else {
        const folderItem = allContainerWindowTypes.find(c => c.name === `techtree_${folder}_item`);
        const folderSmallItem = allContainerWindowTypes.find(c => c.name === `techtree_${folder}_small_item`) || folderItem;
        const lineItem = allContainerWindowTypes.find(c => c.name === 'techtree_line_item');
        const xorItem = allContainerWindowTypes.find(c => c.name === 'techtree_xor_item');
        const commonOptions = {
            getSprite: defaultGetSprite(gfxFiles),
            styleTable,
        };
        children = await (0, containerwindow_1.renderContainerWindowChildren)(folderTreeView, {
            size: { width: 1920, height: 1080 },
            orientation: 'upper_left',
        }, {
            ...commonOptions,
            onRenderChild: async (type, child, parentInfo) => {
                if (type === 'gridbox') {
                    const tree = technologyTrees.find(t => t.startTechnology + '_tree' === child.name);
                    if (tree) {
                        const gridboxType = child;
                        return await renderTechnologyTreeGridBox(tree, gridboxType, folder, folderItem, folderSmallItem, lineItem, xorItem, parentInfo, commonOptions, guiFiles, gfxFiles);
                    }
                }
                return undefined;
            },
        });
    }
    return `<div
        id="techfolder_${folder}"
        class="techfolder ${styleTable.style('displayNone', () => `display:none;`)}"
    >
        ${children}
    </div>`;
}
async function renderTechnologyTreeGridBox(tree, gridboxType, folder, folderItem, folderSmallItem, lineItem, xorItem, parentInfo, commonOptions, guiFiles, gfxFiles) {
    const xorJointKey = "#xorJoint#";
    const treeMap = (0, common_1.arrayToMap)(tree.technologies, 'id');
    const technologiesInFolder = tree.technologies.filter(t => folder in t.folders);
    const technologyXorJoints = technologiesInFolder
        .map(tech => [tech, findXorGroups(treeMap, tech, folder)])
        .filter((t) => t[1] !== undefined && t[1].length > 0)
        .map(([t, tgs]) => [t, tgs[0], tgs.slice(1)]);
    const technologyXorJointsMap = {};
    technologyXorJoints.forEach(([t, tl, tgs]) => technologyXorJointsMap[t.id] = [tl, tgs]);
    const technologyItemsArray = technologiesInFolder.map(t => {
        const jointsItem = technologyXorJointsMap[t.id];
        const connections = [];
        let leadsToTechs;
        if (jointsItem) {
            const [base, joints] = jointsItem;
            leadsToTechs = base;
            connections.push(...joints.map((_, i) => ({ target: xorJointKey + t.id + i, style: "1px solid #88aaff", targetType: "child" })));
        }
        else {
            leadsToTechs = t.leadsToTechs.map(t => treeMap[t]).filter(t => t !== undefined);
        }
        connections.push(...leadsToTechs.map(c => {
            if (c.leadsToTechs.includes(t.id)) {
                return { target: c.id, style: "1px dashed #88aaff", targetType: "related" };
            }
            return { target: c.id, style: "1px solid #88aaff", targetType: "child" };
        }));
        return {
            id: t.id,
            gridX: t.folders[folder].x,
            gridY: t.folders[folder].y,
            connections,
        };
    });
    const technologyXorJointsItemsArray = (0, lodash_1.flatMap)(technologyXorJoints, ([t, _, tgs]) => tgs.map((tl, i) => ({
        id: xorJointKey + t.id + i,
        gridX: Math.round((0, lodash_1.sumBy)(tl, t => t.folders[folder].x) / tl.length),
        gridY: ((0, lodash_1.min)(tl.map(t1 => t1.folders[folder].y)) ?? 0) - 1,
        isJoint: true,
        connections: tl.map(c => {
            return { target: c.id, style: "1px solid red", targetType: "child" };
        }),
    })));
    return await (0, gridbox_1.renderGridBox)(gridboxType, parentInfo, {
        ...commonOptions,
        items: (0, common_1.arrayToMap)([...technologyItemsArray, ...technologyXorJointsItemsArray], 'id'),
        lineRenderMode: lineItem ? 'control' : 'line',
        onRenderItem: async (item, parent) => {
            if (item.id.startsWith(xorJointKey)) {
                if (xorItem === undefined) {
                    return '';
                }
                return await renderXorItem(xorItem, gridboxType.format?._name ?? 'up', parent, commonOptions);
            }
            else {
                const technology = treeMap[item.id];
                const technologyItem = technology.enableEquipments ? folderItem : folderSmallItem;
                return await renderTechnology(technologyItem, technology, technology.folders[folder], parent, commonOptions, guiFiles, gfxFiles);
            }
        },
        onRenderLineBox: async (item, parent) => {
            if (!lineItem) {
                return '';
            }
            return await renderLineItem(lineItem, item, parent, commonOptions);
        },
    });
}
function findXorGroups(treeMap, technology, folder) {
    const techChildren = technology.leadsToTechs
        .map(techName => treeMap[techName])
        .filter(tech => tech && folder in technology.folders);
    const xorGroupMap = {};
    for (const xorChild of techChildren) {
        const xorTechs = xorChild.xor
            .map(techName => treeMap[techName])
            .filter(tech => tech && folder in technology.folders && tech !== xorChild && tech.xor.includes(xorChild.id));
        if (xorTechs.length === 0) {
            continue;
        }
        const groups = xorTechs.map(tech => xorGroupMap[tech.id]).filter((v, i, a) => v !== undefined && i === a.indexOf(v));
        const bigGroup = (0, lodash_1.flatten)(groups).concat([xorChild]);
        bigGroup.forEach(tech => xorGroupMap[tech.id] = bigGroup);
    }
    const xorGroups = Object.values(xorGroupMap).filter((v, i, a) => i === a.indexOf(v));
    if (xorGroups.length === 0) {
        return undefined;
    }
    const nonXors = techChildren.filter(tech => !xorGroups.some(group => group.includes(tech)));
    return [nonXors, ...xorGroups];
}
async function renderXorItem(xorItem, format, parentInfo, commonOptions) {
    const upDownDirection = format === 'left' || format === 'right';
    return await (0, containerwindow_1.renderContainerWindow)(xorItem, parentInfo, {
        ...commonOptions,
        onRenderChild: async (type, child, parent) => {
            if (type === 'icon') {
                const icon = child;
                const childName = child.name?.toLowerCase();
                if (childName === 'first') {
                    return await (0, icon_1.renderIcon)({ ...icon, spritetype: upDownDirection ? 'GFX_techtree_xor_up' : 'GFX_techtree_xor_left' }, parent, commonOptions);
                }
                if (childName === 'second') {
                    return await (0, icon_1.renderIcon)({ ...icon, spritetype: upDownDirection ? 'GFX_techtree_xor_down' : 'GFX_techtree_xor_right' }, parent, commonOptions);
                }
            }
            return undefined;
        },
    });
}
async function renderTechnology(item, technology, folder, parentInfo, commonOptions, guiFiles, gfxFiles) {
    if (!item) {
        return `<div>${(0, i18n_1.localize)('techtree.cantfindtechitemin', "Can't find containerwindowtype \"{0}\" in {1}", `techtree_${folder.name}_item`, guiFiles)}</div>`;
    }
    const subSlotRegex = /^sub_technology_slot_(\d)$/;
    const containerWindow = await (0, containerwindow_1.renderContainerWindow)(item, parentInfo, {
        ...commonOptions,
        noSize: true,
        getSprite: (sprite, callerType, callerName) => getTechnologySprite(sprite, technology, folder.name, callerType, callerName, gfxFiles),
        onRenderChild: async (type, child, parentInfo) => {
            if (type === 'icon' && child.name === 'bonus_icon') {
                return '';
            }
            if (type === 'instanttextbox') {
                const text = child;
                const childname = child.name?.toLowerCase();
                if (childname === 'bonus') {
                    return '';
                }
                else if (childname === 'name') {
                    return await (0, instanttextbox_1.renderInstantTextBox)({ ...text, text: technology.id }, parentInfo, commonOptions);
                }
            }
            if (type === 'containerwindow' && child.name) {
                const subSlot = subSlotRegex.exec(child.name.toLowerCase());
                if (subSlot) {
                    const slotId = parseInt(subSlot[1]);
                    return await renderSubTechnology(child, folder, technology.subTechnologies[slotId], parentInfo, commonOptions, gfxFiles);
                }
            }
            return undefined;
        }
    });
    return `<div
        data-tech-id="${technology.id}" data-tech-small="${technology.enableEquipments ? '0' : '1'}"
        start="${technology.token?.start}"
        end="${technology.token?.end}"
        title="${technology.id}${featureflags_1.localisationIndex ? `\n${await (0, localisationIndex_1.getLocalisedTextQuick)(technology.id)}` : ''}\n(${folder.x}, ${folder.y})"
        class="
            navigator
            ${commonOptions.styleTable.style('navigator', () => `
                position: absolute;
                left: 0;
                top: 0;
                width: 0;
                height: 0;
                cursor: pointer;
                pointer-events: auto;
            `)}
        ">
            ${containerWindow}
        </div>`;
}
async function getTechnologySprite(sprite, technology, folder, callerType, _callerName, gfxFiles) {
    let imageTryList = [sprite];
    if (sprite === 'GFX_technology_unavailable_item_bg' && callerType === 'bg') {
        imageTryList = technology.enableEquipments ? [
            `GFX_technology_${folder}_available_item_bg`,
            `GFX_technology_available_item_bg`,
        ] : [
            `GFX_technology_${folder}_small_available_item_bg`,
            `GFX_technology_small_available_item_bg`,
            `GFX_technology_${folder}_available_item_bg`,
            `GFX_technology_available_item_bg`,
        ];
    }
    else if (sprite === 'GFX_technology_medium' && callerType === 'icon') {
        const result = await (0, imagecache_1.getSpriteByGfxName)(`GFX_${technology.id}_medium`, gfxFiles);
        if (result !== undefined) {
            return result;
        }
        const result2 = await (0, imagecache_1.getSpriteByGfxName)(`GFX_${technology.id}`, gfxFiles);
        if (result2 !== undefined) {
            return result2;
        }
        return await (0, imagecache_1.getSpriteByGfxName)(sprite, gfxFiles);
    }
    return await getSpriteFromTryList(imageTryList, gfxFiles);
}
async function renderSubTechnology(containerWindow, folder, subTechnology, parentInfo, commonOptions, gfxFiles) {
    if (subTechnology === undefined) {
        return '';
    }
    const containerWindowResult = await (0, containerwindow_1.renderContainerWindow)(containerWindow, parentInfo, {
        ...commonOptions,
        getSprite: (sprite, callerType, callerName) => {
            let imageTryList = [sprite];
            if (callerType === 'bg' && callerName === containerWindow.background?.name) {
                imageTryList = [
                    `GFX_subtechnology_${folder}_available_item_bg`,
                    `GFX_subtechnology_available_item_bg`,
                ];
            }
            else if (callerType === 'icon' && callerName?.toLowerCase() === 'picture') {
                return getTechnologyIcon(sprite, gfxFiles);
            }
            return getSpriteFromTryList(imageTryList, gfxFiles);
        }
    });
    return `<div
        data-subtech-id="${subTechnology.id}"
        start="${subTechnology.token?.start}"
        end="${subTechnology.token?.end}"
        title="${subTechnology.id}${featureflags_1.localisationIndex ? `\n${await (0, localisationIndex_1.getLocalisedTextQuick)(subTechnology.id)}` : ''}\n(${folder.x}, ${folder.y})"
        class="
            navigator
            ${commonOptions.styleTable.style('navigator', () => `
                position: absolute;
                left: 0;
                top: 0;
                width: 0;
                height: 0;
                cursor: pointer;
                pointer-events: auto;
            `)}
        ">
            ${containerWindowResult}
        </div>`;
}
const centerNameTable = [
    undefined, undefined, undefined, 'bottom_left',
    undefined, undefined, 'top_left', 'right',
    undefined, 'bottom_right', undefined, 'up',
    'top_right', 'left', 'down', 'all',
];
async function renderLineItem(lineItem, item, parentInfo, commonOptions) {
    const centerNameCode = (item.up ? 1 : 0) | (item.right ? 2 : 0) | (item.down ? 4 : 0) | (item.left ? 8 : 0);
    const centerName = centerNameTable[centerNameCode];
    const directionalItems = [item.up, item.down, item.right, item.left];
    const inSet = (0, lodash_1.chain)(directionalItems).compact().flatMap(c => Object.keys(c.in)).uniq().value();
    const outSet = (0, lodash_1.chain)(directionalItems).compact().flatMap(c => Object.keys(c.out)).uniq().value();
    let sameInOut = false;
    if (inSet.length === outSet.length) {
        sameInOut = true;
        for (const inItem of inSet) {
            if (!outSet.includes(inItem)) {
                sameInOut = false;
                break;
            }
        }
    }
    const containerWindow = await (0, containerwindow_1.renderContainerWindow)(lineItem, parentInfo, {
        ...commonOptions,
        noSize: true,
        onRenderChild: async (type, child, parent) => {
            if (type === 'icon') {
                const icon = child;
                const childName = child.name?.toLowerCase();
                if (childName === 'left' || childName === 'right' || childName === 'up' || childName === 'down') {
                    if (item[childName]) {
                        return await (0, icon_1.renderIcon)({
                            ...icon,
                            spritetype: `GFX_techtree_line_${childName}_${sameInOut ? 'dot_' : ''}states`,
                            frame: 2,
                        }, parent, commonOptions);
                    }
                    else {
                        return '';
                    }
                }
                else if (childName === 'center') {
                    if (centerName && !sameInOut) {
                        return await (0, icon_1.renderIcon)({
                            ...icon,
                            spritetype: `GFX_techline_center_${centerName}_states`, frame: 2
                        }, parent, commonOptions);
                    }
                    else {
                        return '';
                    }
                }
            }
            return undefined;
        },
    });
    return containerWindow;
}
async function getSpriteFromTryList(tryList, gfxFiles) {
    let background = undefined;
    for (const imageName of tryList) {
        background = await (0, imagecache_1.getSpriteByGfxName)(imageName, gfxFiles);
        if (background !== undefined) {
            break;
        }
    }
    return background;
}
async function getTechnologyIcon(name, gfxFiles, defaultIcon) {
    const result = await (0, imagecache_1.getSpriteByGfxName)(name, gfxFiles);
    if (result !== undefined || !defaultIcon) {
        return result;
    }
    return await (0, imagecache_1.getSpriteByGfxName)(defaultIcon, gfxFiles);
}
function defaultGetSprite(gfxFiles) {
    return (sprite) => {
        return (0, imagecache_1.getSpriteByGfxName)(sprite, gfxFiles);
    };
}
//# sourceMappingURL=contentbuilder.js.map