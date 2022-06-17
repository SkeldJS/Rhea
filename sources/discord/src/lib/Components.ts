import discord from "discord.js";

const commandButtonsKey = Symbol("rhea:buttons");

export interface ButtonMeta {
    label: string;
    style: discord.MessageButtonStyle;
    callback: (interaction: discord.ButtonInteraction) => any;
}

export namespace Components {
    export function Button(label: string, style: discord.MessageButtonStyle) {
        return function (target: any, propertyName: string, descriptor: TypedPropertyDescriptor<(interaction: discord.ButtonInteraction) => any>) {
            const components = getAllButtons(target);
            components.set(getNormalisedName(label), {
                label,
                style,
                callback: descriptor.value!
            });
        }
    }

    function getNormalisedName(label: string) {
        return label.toLowerCase().replace(/\W/g, "-");
    }
}

export function getAllButtons(target: any): Map<string, ButtonMeta> {
    const cachedButtons = Reflect.getMetadata(commandButtonsKey, target);
    if (cachedButtons)
        return cachedButtons;

    const buttons: Map<string, ButtonMeta> = new Map;
    Reflect.defineMetadata(commandButtonsKey, buttons, target);

    return buttons;
}