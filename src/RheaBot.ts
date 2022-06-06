import discord from "discord.js";
import crypto from "crypto";

import { REST } from "@discordjs/rest";
import { RheaDatabaseConnection } from "./database";

import {
    BaseCommand,
    getAllButtons,
    getCommandMeta,
    getExecutionMethods
} from "./lib";

export interface RheaBotConfig {
    postgres: {
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
        ssl: "require"|"prefer"|boolean|object;
    };
    redis: {
        host: string;
        port: number;
        password: string|undefined;
    };
}

export class RheaBot {
    client: discord.Client;
    rest: REST;

    database: RheaDatabaseConnection;

    registeredCommands: Map<string, typeof BaseCommand>;
    commandInteractions: Map<string, BaseCommand>;
    
    private randomBuffer: Buffer;

    constructor(config: Partial<RheaBotConfig>, public readonly testingGuildId?: string) {
        this.client = new discord.Client({
            intents: [ discord.Intents.FLAGS.GUILDS ]
        });
        this.rest = new REST();

        this.database = new RheaDatabaseConnection({
            host: "127.0.0.1",
            port: 5379,
            username: "admin",
            password: "1234",
            database: "postgres",
            ...config.postgres
        },
        {
            host: "127.0.0.1",
            port: 6379,
            password: undefined,
            ...config.redis
        });

        this.registeredCommands = new Map;
        this.commandInteractions = new Map;
        this.randomBuffer = Buffer.alloc(32);

        this.client.on("interactionCreate", async interaction => {
            if (testingGuildId && interaction.guildId !== testingGuildId)
                return;

            if (interaction.isCommand()) {
                const commandCtr = this.registeredCommands.get(interaction.commandName);

                if (!commandCtr)
                    return;

                const commandMeta = getCommandMeta(commandCtr);
                
                if (!commandMeta)
                    return;

                const executionId = await this.generateRandomHash();
                const commandInst = this.createCommandInstance(commandCtr, executionId, {});

                if (!commandInst)
                    return;

                const executionMethods = getExecutionMethods(Object.getPrototypeOf(commandInst));

                if (!executionMethods)
                    return;
                
                this.commandInteractions.set(executionId, commandInst);

                const subCommand = interaction.options.getSubcommand(false) || "";

                const executionMethod = executionMethods.get(subCommand);

                if (!executionMethod)
                    return;

                const executionFunction = executionMethod.bind(commandInst);
                await executionFunction(interaction);
                
                await this.database.createInteractionState(executionId, interaction.user.id, interaction.guildId, commandMeta.name, commandMeta.version, commandInst.state);
            } else if (interaction.isButton()) {
                const [ executionId, componentId ] = interaction.customId.split("_");

                const interactionState = await this.database.getInteractionState(executionId);
                
                if (!interactionState) {
                    interaction.reply({ content: "That command was removed from the database for some reason, try using the command again", ephemeral: true });
                    return;
                }

                const commandCtr = this.registeredCommands.get(interactionState.command_name);

                if (!commandCtr) {
                    interaction.reply({ content: "That command was removed from the database for some reason, try using the command again", ephemeral: true });
                    return;
                }

                const commandMeta = getCommandMeta(commandCtr);
                if (commandMeta?.version !== interactionState.command_version) {
                    interaction.reply({ content: "That command has since been updated, try using the command again", ephemeral: true });
                    return;
                }

                const cachedCommandInst = this.commandInteractions.get(interactionState.execution_id);
                const commandInst = cachedCommandInst || this.createCommandInstance(commandCtr, interactionState.execution_id, JSON.parse(interactionState.interaction_state));
                if (!cachedCommandInst) {
                    this.commandInteractions.set(interactionState.execution_id, commandInst);
                }
                
                const allButtonDecls = getAllButtons(Object.getPrototypeOf(commandInst));
                const buttonDecl = allButtonDecls.get(componentId);

                if (buttonDecl) {
                    await buttonDecl.callback.bind(commandInst)(interaction);
                    await this.database.setInteractionState(interactionState.execution_id, commandInst.state);
                }
            }
        });

        setInterval(() => {
            for (const [ executionId, commandInst ] of this.commandInteractions) {
                const executionTime = commandInst.executionDate.getTime();
                if (Date.now() - executionTime > 60 * 1000) {
                    this.commandInteractions.delete(executionId);
                }
            }
        }, 15000);
    }

    generateRandomHash() {
        return new Promise<string>((resolve, reject) => {
            crypto.randomFill(this.randomBuffer, (err, buf) => {
                if (err) {
                    return reject(err);
                }

                const sha1Hash = crypto.createHash("sha1").update(buf);
                resolve(sha1Hash.digest("hex"));
            });
        });
    }

    createCommandInstance(commandCtr: typeof BaseCommand, executionId: string, state = {}) {
        const commandInst = new commandCtr(this, executionId, state);
        const allButtonDecls = getAllButtons(Object.getPrototypeOf(commandInst));

        for (const [ normalisedName, buttonDecl ] of allButtonDecls) {
            const buttonComponent = new discord.MessageButton()
                .setCustomId(executionId + "_" + normalisedName)
                .setLabel(buttonDecl.label)
                .setStyle(buttonDecl.style);

            commandInst.buttons.set(normalisedName, buttonComponent);
        }

        return commandInst;
    }
}