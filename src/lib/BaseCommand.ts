import discord from "discord.js";
import { RheaBot } from "../RheaBot";

export class BaseCommand {
    executionDate: Date;
    buttons: Map<string, discord.MessageButton>;

    constructor(
        public readonly bot: RheaBot,
        public readonly executionId: string,
        public state: any
    ) {
        this.executionDate = new Date;
        this.buttons = new Map;
    }
}