export declare class Logger {
    private static outputChannel;
    static initialize(): void;
    private static logMessage;
    static debug(message: string): void;
    static info(message: string): void;
    static warn(message: string): void;
    static error(message: string): void;
    static show(): void;
}
