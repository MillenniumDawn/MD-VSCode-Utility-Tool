import * as vscode from 'vscode';
import { localize } from '../../util/i18n';
import { Technology, TechnologyTree, TechnologyFolder } from './schema';
import { getSpriteByGfxName, Sprite } from '../../util/image/imagecache';
import { arrayToMap, forceError, UserError } from '../../util/common';
import { HOIPartial } from '../../hoiformat/schema';
import { renderContainerWindow, renderContainerWindowChildren } from '../../util/hoi4gui/containerwindow';
import { ParentInfo, RenderCommonOptions } from '../../util/hoi4gui/common';
import { renderGridBox, GridBoxItem, GridBoxConnection, GridBoxConnectionItem } from '../../util/hoi4gui/gridbox';
import { renderInstantTextBox } from '../../util/hoi4gui/instanttextbox';
import { renderIcon } from '../../util/hoi4gui/icon';
import { html, htmlEscape } from '../../util/html';
import { ContainerWindowType, GridBoxType, IconType, InstantTextBoxType, Format } from '../../hoiformat/gui';
import { TechnologyTreeLoader, TechnologyTreeLoaderResult } from './loader';
import { EquipmentArchetype } from './equipmentschema';
import { LoaderSession } from '../../util/loader/loader';
import { debug } from '../../util/debug';
import { flatMap, sumBy, min, flatten, chain, uniq } from 'lodash';
import { StyleTable } from '../../util/styletable';
import { RenderNodeCommonOptions } from '../../util/hoi4gui/nodecommon';
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { localisationIndex } from "../../util/featureflags";

const techTreeViewName = 'countrytechtreeview';
const doctrineTreeViewName = 'countrydoctrineview';

export async function renderTechnologyFile(loader: TechnologyTreeLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
    try {
        const session = new LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from((session as any).loadedLoader).map<string>(v => (v as any).toString());
        debug('Loader session tech tree', loadedLoaders);

        const technologyTrees = loadResult.result.technologyTrees;
        const folders = uniq(technologyTrees.map(tt => tt.folder));
        
        if (folders.length === 0) {
            const baseContent = localize('techtree.notechtree', 'No technology tree.');
            return html(webview, baseContent, [ setPreviewFileUriScript ], []);
        }

        const styleTable = new StyleTable();
        // Live name-mode switch: all four name variants (short/long equipment name, technology
        // name, raw id) are rendered into the DOM and a "name-mode-*" class on #techtreecontent
        // (driven by the toolbar dropdown) decides which is visible. The default class is
        // "name-mode-id" so the raw id is shown until the user picks another mode. display:contents
        // keeps the instanttextbox absolutely positioned relative to its real ancestor instead of
        // the wrapper span.
        styleTable.raw('.tech-name-variant', 'display: none;');
        styleTable.raw('#techtreecontent.name-mode-short .tech-name-short', 'display: contents;');
        styleTable.raw('#techtreecontent.name-mode-long .tech-name-long', 'display: contents;');
        styleTable.raw('#techtreecontent.name-mode-techname .tech-name-techname', 'display: contents;');
        styleTable.raw('#techtreecontent.name-mode-id .tech-name-id', 'display: contents;');
        const baseContent = await renderTechnologyFolders(technologyTrees, folders, styleTable, loadResult.result);

        return html(
            webview,
            baseContent,
            [
                setPreviewFileUriScript,
                'common.js',
                'techtree.js',
            ],
            [
                'common.css',
                'codicon.css',
                styleTable,
            ],
        );

    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return html(webview, baseContent, [ setPreviewFileUriScript ], []);
    }
}

async function renderTechnologyFolders(technologyTrees: TechnologyTree[], folders: string[], styleTable: StyleTable, loadResult: TechnologyTreeLoaderResult): Promise<string> {
    const guiFiles = loadResult.guiFiles.map(f => f.file);
    const guiTypes = flatMap(loadResult.guiFiles, f => f.data.guitypes);

    const containerWindowTypes = flatMap(guiTypes, t => t.containerwindowtype);
    const techTreeViews = containerWindowTypes.filter(c => c.name?.toLowerCase() === techTreeViewName || c.name?.toLowerCase() === doctrineTreeViewName);
    if (techTreeViews.length === 0) {
        throw new UserError(localize('techtree.cantfindviewin', "Can't find {0} in {1}.", techTreeViewName + "," + doctrineTreeViewName, guiFiles));
    }

    const gfxFiles = loadResult.gfxFiles;
    const equipmentArchetypes = loadResult.equipmentArchetypes;
    const techFolders = (await Promise.all(folders.map(folder => renderTechnologyFolder(technologyTrees, folder, techTreeViews, containerWindowTypes, styleTable, guiFiles, gfxFiles, equipmentArchetypes)))).join('');

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
    class="name-mode-id ${styleTable.oneTimeStyle('mainContent', () => `
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: none;
        margin-top: 40px;
    `)}">
        ${techFolders}
    </div>`;
}

async function renderFolderSelector(folders: string[], styleTable: StyleTable): Promise<string> {
    const folderOptions = await Promise.all(
        folders.map(async (folder) => {
            const localizedText = localisationIndex ? `${await getLocalisedTextQuick(folder)} (${folder})` : folder;
            return `<option value="techfolder_${folder}">${localizedText}</option>`;
        })
    );

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
            ${localize('techtree.techfolder', 'Technology folder: ')}
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
        <div class="${styleTable.oneTimeStyle('showTechLocContainer', () => `display:inline-flex; align-items:center; margin-left:15px`)}">
            <label for="tech-name-mode">${localize('techtree.namemode', 'Name')}</label>
            <select
                id="tech-name-mode"
                class="${styleTable.oneTimeStyle('techNameMode', () => `margin-left:5px`)}"
                data-localisation-index="${localisationIndex}"
            >
                <option value="id">${localize('techtree.namemode.id', 'Id')}</option>
                <option value="short">${localize('techtree.namemode.short', 'Short name')}</option>
                <option value="long">${localize('techtree.namemode.long', 'Long name')}</option>
                <option value="techname">${localize('techtree.namemode.techname', 'Technology name')}</option>
            </select>
            <span
                id="show-loc-warning"
                class="${styleTable.oneTimeStyle('showLocWarning', () => `color:var(--vscode-editorWarning-foreground); margin-left:8px; display:none`)}"
            >⚠ ${localize('techtree.showlocnoindex', 'Localisation index is off — raw ids are shown. Enable the localisation index setting to see localised names.')}</span>
        </div>
    </div>`;
}

async function renderTechnologyFolder(
    technologyTrees: TechnologyTree[],
    folder: string,
    techTreeViews: HOIPartial<ContainerWindowType>[],
    allContainerWindowTypes: HOIPartial<ContainerWindowType>[],
    styleTable: StyleTable,
    guiFiles: string[],
    gfxFiles: string[],
    equipmentArchetypes: Record<string, EquipmentArchetype>,
): Promise<string> {
    const folderTreeView = flatMap(techTreeViews, tv => tv.containerwindowtype).find(c => c.name === folder);
    let children: string;
    if (!folderTreeView) {
        children = `<div>${localize('techtree.cantfindtechfolderin', "Can't find technology folder {0} in {1}.", folder, guiFiles)}</div>`;

    } else {
        const folderItem = allContainerWindowTypes.find(c => c.name === `techtree_${folder}_item`);
        const folderSmallItem = allContainerWindowTypes.find(c => c.name === `techtree_${folder}_small_item`) || folderItem;
        const lineItem = allContainerWindowTypes.find(c => c.name === 'techtree_line_item');
        const xorItem = allContainerWindowTypes.find(c => c.name === 'techtree_xor_item');

        const commonOptions: RenderNodeCommonOptions = {
            getSprite: defaultGetSprite(gfxFiles),
            styleTable,
        };

        children = await renderContainerWindowChildren(
            folderTreeView,
            {
                size: { width: 1920, height: 1080 },
                orientation: 'upper_left',
            },
            {
                ...commonOptions,
                onRenderChild: async (type, child, parentInfo) => {
                    if (type === 'gridbox') {
                        const tree = technologyTrees.find(t => t.startTechnology + '_tree' === child.name);
                        if (tree) {
                            const gridboxType = child as HOIPartial<GridBoxType>;
                            return await renderTechnologyTreeGridBox(tree, gridboxType, folder, folderItem, folderSmallItem, lineItem, xorItem, parentInfo, commonOptions, guiFiles, gfxFiles, equipmentArchetypes);
                        }
                    }

                    return undefined;
                },
            }
        );
    }

    return `<div
        id="techfolder_${folder}"
        class="techfolder ${styleTable.style('displayNone', () => `display:none;`)}"
    >
        ${children}
    </div>`;
}

async function renderTechnologyTreeGridBox(
    tree: TechnologyTree,
    gridboxType: HOIPartial<GridBoxType>,
    folder: string,
    folderItem: HOIPartial<ContainerWindowType> | undefined,
    folderSmallItem: HOIPartial<ContainerWindowType> | undefined,
    lineItem: HOIPartial<ContainerWindowType> | undefined,
    xorItem: HOIPartial<ContainerWindowType> | undefined,
    parentInfo: ParentInfo,
    commonOptions: RenderCommonOptions,
    guiFiles: string[],
    gfxFiles: string[],
    equipmentArchetypes: Record<string, EquipmentArchetype>,
): Promise<string> {
    const xorJointKey = "#xorJoint#";
    const treeMap = arrayToMap(tree.technologies, 'id');
    const technologiesInFolder = tree.technologies.filter(t => folder in t.folders);
    const technologyXorJoints = technologiesInFolder
        .map<[Technology, Technology[][] | undefined]>(tech => [tech, findXorGroups(treeMap, tech, folder)])
        .filter((t): t is [Technology, Technology[][]] => t[1] !== undefined && t[1].length > 0)
        .map<[Technology, Technology[], Technology[][]]>(([t, tgs]) => [t, tgs[0], tgs.slice(1)]);
    const technologyXorJointsMap: Record<string, [Technology[], Technology[][]]> = {};

    technologyXorJoints.forEach(([t, tl, tgs]) => technologyXorJointsMap[t.id] = [tl, tgs]);

    const technologyItemsArray = technologiesInFolder.map<GridBoxItem>(t => {
        const jointsItem = technologyXorJointsMap[t.id];
        const connections: GridBoxConnection[] = [];
        let leadsToTechs: Technology[];
        if (jointsItem) {
            const [base, joints] = jointsItem;
            leadsToTechs = base;
            connections.push(...joints.map<GridBoxConnection>((_, i) => ({ target: xorJointKey + t.id + i, style: "1px solid #88aaff", targetType: "child" })));
        } else {
            leadsToTechs = t.leadsToTechs.map(t => treeMap[t]).filter(t => t !== undefined);
        }

        connections.push(...leadsToTechs.map<GridBoxConnection>(c => {
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

    const technologyXorJointsItemsArray = flatMap(technologyXorJoints, ([t, _, tgs]) =>
        tgs.map<GridBoxItem>((tl, i) => ({
            id: xorJointKey + t.id + i,
            gridX: Math.round(sumBy(tl, t => t.folders[folder].x) / tl.length),
            gridY: (min(tl.map(t1 => t1.folders[folder].y)) ?? 0) - 1,
            isJoint: true,
            connections: tl.map<GridBoxConnection>(c => {
                return { target: c.id, style: "1px solid red", targetType: "child" };
            }),
        }))
    );

    return await renderGridBox(gridboxType, parentInfo, {
        ...commonOptions,
        items: arrayToMap([...technologyItemsArray, ...technologyXorJointsItemsArray], 'id'),
        lineRenderMode: lineItem ? 'control' : 'line',
        onRenderItem: async (item, parent) => {
            if (item.id.startsWith(xorJointKey)) {
                if (xorItem === undefined) {
                    return '';
                }
                return await renderXorItem(xorItem, gridboxType.format?._name ?? 'up', parent, commonOptions);
            } else {
                const technology = treeMap[item.id];
                const technologyItem = technology.enableEquipments ? folderItem : folderSmallItem;
                return await renderTechnology(technologyItem, technology, technology.folders[folder], parent, commonOptions, guiFiles, gfxFiles, equipmentArchetypes);
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

function findXorGroups(treeMap: Record<string, Technology>, technology: Technology, folder: string): Technology[][] | undefined {
    const techChildren = technology.leadsToTechs
        .map(techName => treeMap[techName])
        .filter(tech => tech && folder in technology.folders);
    const xorGroupMap: Record<string, Technology[]> = {};

    for (const xorChild of techChildren) {
        const xorTechs = xorChild.xor
            .map(techName => treeMap[techName])
            .filter(tech => tech && folder in technology.folders && tech !== xorChild && tech.xor.includes(xorChild.id));
        if (xorTechs.length === 0) {
            continue;
        }

        const groups = xorTechs.map(tech => xorGroupMap[tech.id]).filter((v, i, a) => v !== undefined && i === a.indexOf(v));
        const bigGroup = flatten(groups).concat([ xorChild ]);
        bigGroup.forEach(tech => xorGroupMap[tech.id] = bigGroup);
    }

    const xorGroups = Object.values(xorGroupMap).filter((v, i, a) => i === a.indexOf(v));
    if (xorGroups.length === 0) {
        return undefined;
    }

    const nonXors = techChildren.filter(tech => !xorGroups.some(group => group.includes(tech)));
    return [nonXors, ...xorGroups];
}

async function renderXorItem(xorItem: HOIPartial<ContainerWindowType>, format: Format['_name'], parentInfo: ParentInfo, commonOptions: RenderCommonOptions): Promise<string> {
    const upDownDirection = format === 'left' || format === 'right';
    return await renderContainerWindow(xorItem, parentInfo, {
        ...commonOptions,
        onRenderChild: async (type, child, parent) => {
            if (type === 'icon') {
                const icon = child as HOIPartial<IconType>;
                const childName = child.name?.toLowerCase();
                if (childName === 'first') {
                    return await renderIcon({...icon, spritetype: upDownDirection ? 'GFX_techtree_xor_up' : 'GFX_techtree_xor_left' },
                        parent, commonOptions);
                }
                if (childName === 'second') {
                    return await renderIcon({ ...icon, spritetype: upDownDirection ? 'GFX_techtree_xor_down' : 'GFX_techtree_xor_right' },
                        parent, commonOptions);
                }
            }

            return undefined;
        },
    });
}

interface TechNameKeys {
    shortKey?: string;
    longKey?: string;
    techKey?: string;
    id: string;
}

// Resolves the localisation keys HOI4 can use for a technology's tree name, in the forms the
// name-mode dropdown exposes (short equipment name, long equipment name, technology name).
// getLocalisedTextQuick returns the key unchanged when missing, so a key is "resolved" only
// when its localisation differs from the key itself. `id` (the raw token) is always present.
async function resolveTechNameKeys(technology: Technology, equipmentArchetypes: Record<string, EquipmentArchetype>): Promise<TechNameKeys> {
    const keys: TechNameKeys = { id: technology.id };

    if (!localisationIndex) {
        return keys;
    }

    const techLoc = await getLocalisedTextQuick(technology.id);
    if (techLoc && techLoc !== technology.id) {
        keys.techKey = technology.id;
    }

    for (const equipment of technology.enableEquipmentNames) {
        if (keys.shortKey === undefined) {
            const shortKey = resolveShortNameKey(equipment, equipmentArchetypes);
            const shortLoc = await getLocalisedTextQuick(shortKey);
            if (shortLoc && shortLoc !== shortKey) {
                keys.shortKey = shortKey;
            }
        }
        if (keys.longKey === undefined) {
            const longLoc = await getLocalisedTextQuick(equipment);
            if (longLoc && longLoc !== equipment) {
                keys.longKey = equipment;
            }
        }
        if (keys.shortKey !== undefined && keys.longKey !== undefined) {
            break;
        }
    }

    return keys;
}

// Finds the short-name localisation key for an equipment: its archetype `short_name` field
// (chasing the `archetype` parent when the equipment itself declares none), falling back to
// the `<equipment>_short` naming convention HOI4 uses by default.
function resolveShortNameKey(equipment: string, equipmentArchetypes: Record<string, EquipmentArchetype>): string {
    const direct = equipmentArchetypes[equipment];
    if (direct?.shortName) {
        return direct.shortName;
    }
    if (direct?.archetype) {
        const parent = equipmentArchetypes[direct.archetype];
        if (parent?.shortName) {
            return parent.shortName;
        }
    }
    return `${equipment}_short`;
}

async function renderTechnology(
    item: HOIPartial<ContainerWindowType> | undefined,
    technology: Technology,
    folder: TechnologyFolder,
    parentInfo: ParentInfo,
    commonOptions: RenderCommonOptions,
    guiFiles: string[],
    gfxFiles: string[],
    equipmentArchetypes: Record<string, EquipmentArchetype>,
): Promise<string> {
    if (!item) {
        return `<div>${localize('techtree.cantfindtechitemin', "Can't find containerwindowtype \"{0}\" in {1}", `techtree_${folder.name}_item`, guiFiles)}</div>`;
    }

    const nameKeys = await resolveTechNameKeys(technology, equipmentArchetypes);
    // Per-mode fallback chains (see the name-mode dropdown). undefined => fall back to the raw id.
    const shortMode = nameKeys.shortKey ?? nameKeys.longKey ?? nameKeys.techKey;
    const longMode = nameKeys.longKey ?? nameKeys.shortKey ?? nameKeys.techKey;
    const techMode = nameKeys.techKey;
    const bestNameKey = shortMode ?? longMode ?? techMode ?? technology.id;
    const subSlotRegex = /^sub_technology_slot_(\d)$/;
    const containerWindow = await renderContainerWindow(item, parentInfo, {
        ...commonOptions,
        noSize: true,
        getSprite: (sprite, callerType, callerName) => getTechnologySprite(sprite, technology, folder.name, callerType, callerName, gfxFiles),
        onRenderChild: async (type, child, parentInfo) => {
            if (type === 'icon' && child.name === 'bonus_icon') {
                return '';
            }

            if (type === 'instanttextbox') {
                const text = child as HOIPartial<InstantTextBoxType>;
                const childname = child.name?.toLowerCase();
                if (childname === 'bonus') {
                    return '';
                } else if (childname === 'name') {
                    // A box per dropdown mode; when a mode has no key it falls back to the raw id.
                    const makeBox = (key: string | undefined) => key !== undefined
                        ? renderInstantTextBox({ ...text, text: key }, parentInfo, commonOptions)
                        : renderInstantTextBox({ ...text, text: technology.id }, parentInfo, { ...commonOptions, rawText: true });
                    const [shortBox, longBox, techBox, idBox] = await Promise.all([
                        makeBox(shortMode), makeBox(longMode), makeBox(techMode),
                        renderInstantTextBox({ ...text, text: technology.id }, parentInfo, { ...commonOptions, rawText: true }),
                    ]);
                    return `<span class="tech-name-variant tech-name-short">${shortBox}</span>`
                        + `<span class="tech-name-variant tech-name-long">${longBox}</span>`
                        + `<span class="tech-name-variant tech-name-techname">${techBox}</span>`
                        + `<span class="tech-name-variant tech-name-id">${idBox}</span>`;
                }
            }

            if (type === 'containerwindow' && child.name) {
                const subSlot = subSlotRegex.exec(child.name.toLowerCase());
                if (subSlot) {
                    const slotId = parseInt(subSlot[1]);
                    return await renderSubTechnology(child as HOIPartial<ContainerWindowType>, folder, technology.subTechnologies[slotId], parentInfo, commonOptions, gfxFiles);
                }
            }

            return undefined;
        }
    });

    return `<div
        data-tech-id="${technology.id}" data-tech-small="${technology.enableEquipments ? '0' : '1'}"
        start="${technology.token?.start}"
        end="${technology.token?.end}"
        title="${technology.id}${localisationIndex ? `\n${await getLocalisedTextQuick(bestNameKey)}` : ''}\n(${folder.x}, ${folder.y})"
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

async function getTechnologySprite(sprite: string, technology: Technology, folder: string, callerType: 'bg' | 'icon', _callerName: string | undefined, gfxFiles: string[]): Promise<Sprite | undefined> {
    let imageTryList: string[] = [sprite];
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
    } else if (sprite === 'GFX_technology_medium' && callerType === 'icon') {
        const result = await getSpriteByGfxName(`GFX_${technology.id}_medium`, gfxFiles);
        if (result !== undefined) { return result; }
        const result2 = await getSpriteByGfxName(`GFX_${technology.id}`, gfxFiles);
        if (result2 !== undefined) { return result2; }
        return await getSpriteByGfxName(sprite, gfxFiles);
    }

    return await getSpriteFromTryList(imageTryList, gfxFiles);
}

async function renderSubTechnology(
    containerWindow: HOIPartial<ContainerWindowType>,
    folder: TechnologyFolder,
    subTechnology: Technology | undefined,
    parentInfo: ParentInfo,
    commonOptions: RenderCommonOptions,
    gfxFiles: string[],
): Promise<string> {
    if (subTechnology === undefined) {
        return '';
    }

    const containerWindowResult = await renderContainerWindow(containerWindow, parentInfo, {
        ...commonOptions,
        getSprite: (sprite, callerType, callerName) => {
            let imageTryList = [sprite];
            if (callerType === 'bg' && callerName === containerWindow.background?.name) {
                imageTryList = [
                    `GFX_subtechnology_${folder}_available_item_bg`,
                    `GFX_subtechnology_available_item_bg`,
                ];
            } else if (callerType === 'icon' && callerName?.toLowerCase() === 'picture') {
                return getTechnologyIcon(sprite, gfxFiles);
            }

            return getSpriteFromTryList(imageTryList, gfxFiles);
        }
    });

    return `<div
        data-subtech-id="${subTechnology.id}"
        start="${subTechnology.token?.start}"
        end="${subTechnology.token?.end}"
        title="${subTechnology.id}${localisationIndex ? `\n${await getLocalisedTextQuick(subTechnology.id)}` : ''}\n(${folder.x}, ${folder.y})"
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

async function renderLineItem(
    lineItem: HOIPartial<ContainerWindowType>,
    item: GridBoxConnectionItem,
    parentInfo: ParentInfo,
    commonOptions: RenderCommonOptions,
): Promise<string> {
    const centerNameCode = (item.up ? 1 : 0) | (item.right ? 2 : 0) | (item.down ? 4 : 0) | (item.left ? 8 : 0);
    const centerName: string | undefined = centerNameTable[centerNameCode];

    const directionalItems = [ item.up, item.down, item.right, item.left ];
    const inSet = chain(directionalItems).compact().flatMap(c => Object.keys(c.in)).uniq().value();
    const outSet = chain(directionalItems).compact().flatMap(c => Object.keys(c.out)).uniq().value();
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

    const containerWindow = await renderContainerWindow(lineItem, parentInfo, {
        ...commonOptions,
        noSize: true,
        onRenderChild: async (type, child, parent) => {
            if (type === 'icon') {
                const icon = child as HOIPartial<IconType>;
                const childName = child.name?.toLowerCase();
                if (childName === 'left' || childName === 'right' || childName === 'up' || childName === 'down') {
                    if (item[childName]) {
                        return await renderIcon({
                            ...icon,
                            spritetype: `GFX_techtree_line_${childName}_${sameInOut ? 'dot_' : ''}states`,
                            frame: 2,
                        }, parent, commonOptions);
                    } else {
                        return '';
                    }
                } else if (childName === 'center') {
                    if (centerName && !sameInOut) {
                        return await renderIcon({
                            ...icon,
                            spritetype: `GFX_techline_center_${centerName}_states`, frame: 2
                        }, parent, commonOptions);
                    } else {
                        return '';
                    }
                }
            }

            return undefined;
        },
    });

    return containerWindow;
}

async function getSpriteFromTryList(tryList: string[], gfxFiles: string[]): Promise<Sprite | undefined> {
    let background: Sprite | undefined = undefined;
    for (const imageName of tryList) {
        background = await getSpriteByGfxName(imageName, gfxFiles);
        if (background !== undefined) {
            break;
        }
    }

    return background;
}

async function getTechnologyIcon(name: string, gfxFiles: string[], defaultIcon?: string): Promise<Sprite | undefined> {
    const result = await getSpriteByGfxName(name, gfxFiles);
    if (result !== undefined || !defaultIcon) {
        return result;
    }

    return await getSpriteByGfxName(defaultIcon, gfxFiles);
}

function defaultGetSprite(gfxFiles: string[]) {
    return (sprite: string) => {
        return getSpriteByGfxName(sprite, gfxFiles);
    };
}
