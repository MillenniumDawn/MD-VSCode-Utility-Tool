import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo } from "./common";
import { ButtonType, ContainerWindowType, GridBoxType, IconType, InstantTextBoxType } from "../../hoiformat/gui";
import { RenderNodeCommonOptions } from './nodecommon';
export interface RenderChildTypeMap {
    containerwindow: HOIPartial<ContainerWindowType>;
    gridbox: HOIPartial<GridBoxType>;
    icon: HOIPartial<IconType>;
    instanttextbox: HOIPartial<InstantTextBoxType>;
    button: HOIPartial<ButtonType>;
}
export interface RenderContainerWindowOptions extends RenderNodeCommonOptions {
    noSize?: boolean;
    ignorePosition?: boolean;
    onRenderChild?<T extends keyof RenderChildTypeMap>(type: T, child: RenderChildTypeMap[T], parentInfo: ParentInfo): Promise<string | undefined>;
}
export declare function renderContainerWindow(containerWindow: HOIPartial<ContainerWindowType>, parentInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<string>;
export declare function renderContainerWindowChildren(containerWindow: HOIPartial<ContainerWindowType>, myInfo: ParentInfo, options: RenderContainerWindowOptions): Promise<string>;
export declare function onRenderChildOrDefault<T extends keyof RenderChildTypeMap>(onRenderChild: RenderContainerWindowOptions['onRenderChild'], type: T, child: RenderChildTypeMap[T], parentInfo: ParentInfo, defaultRenderer: (c: RenderChildTypeMap[T]) => Promise<string>): Promise<[number, string]>;
