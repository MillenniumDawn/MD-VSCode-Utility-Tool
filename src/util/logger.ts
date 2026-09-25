import * as vscode from 'vscode';

enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

export class Logger {
    private static outputChannel: vscode.OutputChannel | undefined;
    private static disposed = false;

    public static initialize(): vscode.Disposable {
        Logger.disposed = false;
        if (!Logger.outputChannel) {
            Logger.outputChannel = vscode.window.createOutputChannel('HOI4 Modding');
        }
        return { dispose: () => Logger.dispose() };
    }

    public static dispose() {
        Logger.outputChannel?.dispose();
        Logger.outputChannel = undefined;
        Logger.disposed = true;
    }

    private static logMessage(level: LogLevel, message: string) {
        // A log after deactivation would otherwise create a channel nothing disposes.
        if (Logger.disposed) {
            return;
        }
        if (!Logger.outputChannel) {
            Logger.initialize();
        }
        const timestamp = new Date().toISOString();
        Logger.outputChannel?.appendLine(`[${timestamp}] [${level}] ${message}`);
    }

    public static debug(message: string) {
        Logger.logMessage(LogLevel.DEBUG, message);
    }

    public static info(message: string) {
        Logger.logMessage(LogLevel.INFO, message);
    }

    public static warn(message: string) {
        Logger.logMessage(LogLevel.WARN, message);
    }

    public static error(message: string) {
        Logger.logMessage(LogLevel.ERROR, message);
    }
}
