interface VSCodeApi {
    postMessage<T>(message: T): void;
    getState(): any;
    setState(state: any): void;
}
declare function acquireVsCodeApi(): VSCodeApi;
export const vscode = acquireVsCodeApi();
