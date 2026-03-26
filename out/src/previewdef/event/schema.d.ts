import { Node, Token } from "../../hoiformat/hoiparser";
export interface HOIEvents {
    eventItemsByNamespace: Record<string, HOIEvent[]>;
}
export type HOIEventType = 'country' | 'state' | 'unit_leader' | 'news' | 'operative_leader';
export interface HOIEvent {
    type: HOIEventType;
    id: string;
    title: string;
    namespace: string;
    picture?: string;
    immediate: HOIEventOption;
    options: HOIEventOption[];
    token: Token | undefined;
    major: boolean;
    hidden: boolean;
    isTriggeredOnly: boolean;
    meanTimeToHappenBase: number;
    fire_only_once: boolean;
    file: string;
}
export interface HOIEventOption {
    name?: string;
    childEvents: ChildEvent[];
    token: Token | undefined;
}
export interface ChildEvent {
    scopeName: string;
    eventName: string;
    days: number;
    hours: number;
    randomDays: number;
    randomHours: number;
}
export declare function getEvents(node: Node, filePath: string): HOIEvents;
