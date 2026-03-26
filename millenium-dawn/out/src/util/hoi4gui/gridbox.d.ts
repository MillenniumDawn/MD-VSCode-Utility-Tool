import { GridBoxType } from '../../hoiformat/gui';
import { HOIPartial } from '../../hoiformat/schema';
import { ParentInfo } from './common';
import { RenderGridBoxCommonOptions } from './gridboxcommon';
import { RenderNodeCommonOptions } from './nodecommon';
export * from './gridboxcommon';
type TypeMix = RenderGridBoxCommonOptions & RenderNodeCommonOptions;
export interface RenderGridBoxOptions extends TypeMix {
}
export declare function renderGridBox(gridBox: HOIPartial<GridBoxType>, parentInfo: ParentInfo, options: RenderGridBoxOptions): Promise<string>;
