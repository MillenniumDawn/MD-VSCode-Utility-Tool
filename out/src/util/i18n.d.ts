import { __table } from '../../i18n/en';
export declare function loadI18n(locale?: string): void;
export declare function localize(key: keyof typeof __table | 'TODO', message: string, ...args: any[]): string;
export declare function localizeText(text: string): string;
export declare function i18nTableAsScript(): string;
