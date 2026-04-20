import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo } from "./common";
import { ButtonType } from "../../hoiformat/gui";
import { RenderNodeCommonOptions } from './nodecommon';
export interface RenderButtonOptions extends RenderNodeCommonOptions {
}
export declare function renderButton(button: HOIPartial<ButtonType>, parentInfo: ParentInfo, options: RenderButtonOptions): Promise<string>;
