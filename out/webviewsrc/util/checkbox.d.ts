import { Subscriber } from "./event";
export declare function enableCheckboxes(): void;
export declare class Checkbox extends Subscriber {
    readonly input: HTMLInputElement;
    private text?;
    constructor(input: HTMLInputElement, text?: string | undefined);
    private init;
    private addEventHandlersForCheckBox;
}
