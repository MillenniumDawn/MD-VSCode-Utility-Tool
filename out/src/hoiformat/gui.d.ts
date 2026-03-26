import { Token } from "./hoiparser";
import { NumberLike, SchemaDef, Position, StringIgnoreCase } from "./schema";
export interface Size {
    width: NumberLike;
    height: NumberLike;
    x: NumberLike;
    y: NumberLike;
}
export interface ComplexSize extends Size {
    min: Size;
}
export interface Margin {
    top: NumberLike;
    left: NumberLike;
    right: NumberLike;
    bottom: NumberLike;
}
export type Format = StringIgnoreCase<'left' | 'right' | 'up' | 'down' | 'center'>;
export type Orientation = StringIgnoreCase<'upper_left' | 'upper_right' | 'lower_left' | 'lower_right' | 'center_up' | 'center_down' | 'center_left' | 'center_right' | 'center'>;
export interface Background {
    name: string;
    spritetype: string;
    quadtexturesprite: string;
    position: Position;
}
export interface GuiTypes {
    containerwindowtype: ContainerWindowType[];
    windowtype: ContainerWindowType[];
}
export interface ContainerWindowType {
    name: string;
    orientation: Orientation;
    origo: Orientation;
    position: Position;
    size: ComplexSize;
    margin: Margin;
    background: Background;
    containerwindowtype: ContainerWindowType[];
    windowtype: ContainerWindowType[];
    gridboxtype: GridBoxType[];
    icontype: IconType[];
    instanttextboxtype: InstantTextBoxType[];
    textboxtype: InstantTextBoxType[];
    buttontype: ButtonType[];
    checkboxtype: ButtonType[];
    guibuttontype: ButtonType[];
    _index: number;
    _token: Token;
}
export interface GridBoxType {
    name: string;
    orientation: Orientation;
    position: Position;
    size: Size;
    background: Background;
    slotsize: Size;
    format: Format;
    _index: number;
    _token: Token;
}
export interface IconType {
    name: string;
    orientation: Orientation;
    position: Position;
    centerposition: boolean;
    spritetype: string;
    quadtexturesprite: string;
    frame: number;
    scale: number;
    _index: number;
    _token: Token;
}
export interface InstantTextBoxType {
    name: string;
    orientation: Orientation;
    position: Position;
    bordersize: Position;
    maxwidth: NumberLike;
    maxheight: NumberLike;
    font: string;
    text: string;
    format: Format;
    vertical_alignment: string;
    _index: number;
    _token: Token;
}
export interface ButtonType {
    name: string;
    orientation: Orientation;
    position: Position;
    spritetype: string;
    quadtexturesprite: string;
    frame: number;
    text: string;
    buttontext: string;
    buttonfont: string;
    scale: number;
    centerposition: boolean;
    _index: number;
    _token: Token;
}
export interface GuiFile {
    guitypes: GuiTypes[];
}
export declare const guiFileSchema: SchemaDef<GuiFile>;
