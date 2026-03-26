import { Node, Token } from "./hoiparser";
import { NumberPosition } from "../util/common";
export interface SpriteType {
    name: string;
    texturefile: string;
    noofframes: number;
    token: Token | undefined;
}
export interface CorneredTileSpriteType {
    name: string;
    texturefile: string;
    noofframes: number;
    size: NumberPosition;
    bordersize: NumberPosition;
    tilingCenter: boolean;
    token: Token | undefined;
}
export declare function getSpriteTypes(node: Node): (SpriteType | CorneredTileSpriteType)[];
