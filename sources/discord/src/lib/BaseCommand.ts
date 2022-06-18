import discord from "discord.js";
import { RheaDiscordBot } from "../RheaDiscordBot";

export class BaseCommand {
    executionDate: Date;
    buttons: Map<string, discord.MessageButton>;

    constructor(
        public readonly bot: RheaDiscordBot,
        public readonly executionId: string,
        public state: any
    ) {
        this.executionDate = new Date;
        this.buttons = new Map;
    }

    static async setup() {}
}