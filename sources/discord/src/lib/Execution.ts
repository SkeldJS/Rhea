import discord from "discord.js";

const commandExecutionKey = Symbol("rhea:executions");

export type CommandExecutionMethod = ((interaction: discord.CommandInteraction) => any);

export function Execution(subCommand: string = "") {
    return function (target: any, propertyName: string, descriptor: TypedPropertyDescriptor<CommandExecutionMethod>) {
        const executionMethods = getExecutionMethods(target);
        executionMethods.set(subCommand, descriptor.value!);
        return target;
    }
}

export function getExecutionMethods(target: any): Map<string, CommandExecutionMethod> {
    const cacheExecutionMethods = Reflect.getMetadata(commandExecutionKey, target);
    if (cacheExecutionMethods)
        return cacheExecutionMethods;

    const buttons: Map<string, CommandExecutionMethod> = new Map;
    Reflect.defineMetadata(commandExecutionKey, buttons, target);

    return buttons;
}