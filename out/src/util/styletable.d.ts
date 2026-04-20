export declare class StyleTable {
    private readonly records;
    private readonly rawRecords;
    private id;
    style(name: string, callback: () => string, fakeClass?: string): string;
    style(name: string, callback: () => Promise<string>, fakeClass?: string): Promise<string>;
    oneTimeStyle(name: string, callback: () => string, fakeClass?: string): string;
    oneTimeStyle(name: string, callback: () => Promise<string>, fakeClass?: string): Promise<string>;
    toStyleElement(nonce: string): string;
    name(name: string): string;
    raw(selector: string, content: string): void;
}
export declare function normalizeForStyle(name: string): string;
