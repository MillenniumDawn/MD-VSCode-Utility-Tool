import { Background } from '../../hoiformat/gui';
import { HOIPartial } from '../../hoiformat/schema';
import { NumberPosition, NumberSize } from '../common';
import { CorneredTileSprite, Sprite } from '../image/sprite';
import { ParentInfo, RenderCommonOptions } from './common';
export interface RenderNodeCommonOptions extends RenderCommonOptions {
    getSprite?(sprite: string, callerType: 'bg' | 'icon', callerName: string | undefined): Promise<Sprite | undefined>;
}
export declare function renderSprite(position: NumberPosition, size: NumberSize, sprite: Sprite, frame: number, scale: number, options: RenderCommonOptions): string;
export declare function renderCorneredTileSprite(position: NumberPosition, size: NumberSize, sprite: CorneredTileSprite, frame: number, options: RenderCommonOptions): string;
export declare function renderBackground(background: HOIPartial<Background> | undefined, parentInfo: ParentInfo, commonOptions: RenderNodeCommonOptions): Promise<string>;
