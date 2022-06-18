import * as dtypes from "discord-api-types/v9";
import { BaseEvent } from "./BaseEvent";

const eventMetaKey = Symbol("rhea:event");
const eventVersionKey = Symbol("rhea:eventVersion");

export type EventMeta = {
    repoName: string;
    eventName: string;
    match: (body: any) => boolean;
}

export function Event(repoName: string, eventName: string, match: (body: any) => boolean = (body: any) => true) {
    return function (target: any) {
        Reflect.defineMetadata(eventMetaKey, { repoName, eventName, match }, target);
        return target;
    }
}

export function getEventMeta(event: typeof BaseEvent) {
    return Reflect.getMetadata(eventMetaKey, event) as EventMeta|undefined;
}