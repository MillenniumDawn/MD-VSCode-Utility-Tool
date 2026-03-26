import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo, RenderCommonOptions } from "./common";
import { InstantTextBoxType } from "../../hoiformat/gui";
export interface RenderInstantTextBoxOptions extends RenderCommonOptions {
}
export declare function renderInstantTextBox(textbox: HOIPartial<InstantTextBoxType>, parentInfo: ParentInfo, options: RenderInstantTextBoxOptions): Promise<string>;
