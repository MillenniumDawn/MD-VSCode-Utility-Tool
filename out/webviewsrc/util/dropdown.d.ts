import { Subscriber } from "./event";
import { BehaviorSubject } from 'rxjs';
export declare const numDropDownOpened$: BehaviorSubject<number>;
export declare function enableDropdowns(): void;
export declare class DivDropdown extends Subscriber {
    readonly select: HTMLDivElement;
    private multiSelection;
    private closeDropdown;
    selectedValues$: BehaviorSubject<readonly string[]>;
    constructor(select: HTMLDivElement, multiSelection?: boolean);
    selectAll(): void;
    private init;
    private showSelectionsForDropdown;
    private getOptions;
    private updateSelectedValue;
}
