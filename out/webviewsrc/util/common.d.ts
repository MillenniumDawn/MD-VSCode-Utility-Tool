export { arrayToMap } from '../../src/util/common';
export declare function setState(obj: Record<string, any>): void;
export declare function getState(): Record<string, any>;
export declare function scrollToState(): void;
export declare function copyArray<T>(src: T[], dst: T[], offsetSrc: number, offsetDst: number, length: number): void;
export declare function subscribeNavigators(): void;
export declare function tryRun<T extends (...args: any[]) => any>(func: T): (...args: Parameters<T>) => ReturnType<T> | undefined;
export declare function enableZoom(contentElement: HTMLDivElement, xOffset: number, yOffset: number): void;
export declare function subscribeRefreshButton(): void;
