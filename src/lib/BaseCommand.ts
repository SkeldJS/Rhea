import discord from "discord.js";
import { RheaBot } from "../RheaBot";

export class BaseCommand {
    buttons: Map<string, discord.MessageButton>;

    constructor(
        public readonly bot: RheaBot,
        public readonly executionId: string,
        public state: any
    ) {
        this.buttons = new Map;
    }
}