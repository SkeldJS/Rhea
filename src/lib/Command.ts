import * as dtypes from "discord-api-types/v9";
import { BaseCommand } from "./BaseCommand";

const commandMetaKey = Symbol("rhea:command");
const commandVersionKey = Symbol("rhea:commandVersion");

export type CommandMeta = dtypes.RESTPostAPIApplicationCommandsJSONBody & {
    version: string;
};

export function Command(options: CommandMeta) {
    return function (target: any) {
        Reflect.defineMetadata(commandMetaKey, options, target);
        return target;
    }
}

export function getCommandMeta(command: typeof BaseCommand) {
    return Reflect.getMetadata(commandMetaKey, command) as CommandMeta|undefined;
}