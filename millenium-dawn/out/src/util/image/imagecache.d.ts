import { Sprite, Image } from './sprite';
export { Sprite, Image };
export declare function getImageByPath(relativePath: string): Promise<Image | undefined>;
export declare function getSpriteByGfxName(name: string, gfxFilePath: string | string[]): Promise<Sprite | undefined>;
