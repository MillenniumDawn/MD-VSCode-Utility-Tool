import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo } from "./common";
import { IconType } from "../../hoiformat/gui";
import { RenderNodeCommonOptions } from './nodecommon';
export interface RenderIconOptions extends RenderNodeCommonOptions {
}
export declare function renderIcon(icon: HOIPartial<IconType>, parentInfo: ParentInfo, options: RenderIconOptions): Promise<string>;
