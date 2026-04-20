"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (LogLevel = {}));
class Logger {
    static outputChannel;
    static initialize() {
        if (!Logger.outputChannel) {
            Logger.outputChannel = vscode.window.createOutputChannel('HOI4 Modding');
        }
    }
    static logMessage(level, message) {
        if (!Logger.outputChannel) {
            Logger.initialize();
        }
        const timestamp = new Date().toISOString();
        Logger.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }
    static debug(message) {
        Logger.logMessage(LogLevel.DEBUG, message);
    }
    static info(message) {
        Logger.logMessage(LogLevel.INFO, message);
    }
    static warn(message) {
        Logger.logMessage(LogLevel.WARN, message);
    }
    static error(message) {
        Logger.logMessage(LogLevel.ERROR, message);
    }
    static show() {
        if (Logger.outputChannel) {
            Logger.outputChannel.show();
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map