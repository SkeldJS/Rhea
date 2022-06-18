import "reflect-metadata";

import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";

import * as dtypes from "discord-api-types/v9";

import { BaseCommand, CommandMeta, getCommandMeta, RheaDiscordBot } from "@skeldjs/rhea-discord";
import { BaseEvent, getEventMeta, RheaWebhookServer, webhook } from "@skeldjs/rhea-github";

dotenv.config({
    path: path.resolve(process.cwd(), ".env")
});

async function getCommandsCached() {
    try {
        return await fs.readFile(path.resolve(__dirname, "./.commands-cache"));
    } catch (e) {
        return undefined;
    }
}

function getCommandsHash(commands: any) {
    return crypto.createHash("sha256").update(JSON.stringify(commands)).digest();
}

async function writeCommandsCached(hash: Buffer) {
    await fs.writeFile(path.resolve(__dirname, "./.commands-cache"), hash, "binary");
}

(async () => {
    const discordBot = new RheaDiscordBot({
        postgres: {
            host: process.env.POSTGRES_HOST as string || "127.0.0.1",
            port: parseInt(process.env.POSTGRES_PORT || "5379"),
            username: process.env.POSTGRES_USER || "admin",
            password: process.env.POSTGRES_PASSWORD || "1234",
            database: process.env.POSTGRES_DATABASE || "postgres",
            ssl: "prefer"
        },
        redis: {
            host: process.env.REDIS_HOST as string || "127.0.0.1",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            password: process.env.REDIS_PASSWORD as string|undefined
        }
    }, process.env.GUILD_ID as string|undefined);

    const webhookServer = new RheaWebhookServer;
    webhookServer.listen(process.env.PORT ? parseInt(process.env.PORT) : 8000);

    const commandFiles = await fs.readdir(path.resolve(__dirname, "./commands"));
    for (const file of commandFiles) {
        if (file.endsWith(".js.map") || file.endsWith(".d.ts"))
            continue;

        try {
            const { default: importedCommand } = await import(path.resolve(__dirname, "./commands", file)) as { default: typeof BaseCommand };
            const meta = getCommandMeta(importedCommand);
    
            if (meta) {
                await importedCommand.setup();
                discordBot.registeredCommands.set(meta.name, importedCommand);
            }
        } catch (e) {
            console.log("Failed to load command %s:", file);
            console.log(e);
        }
    }
    
    const eventFiles = await fs.readdir(path.resolve(__dirname, "./events"));
    for (const file of eventFiles) {
        if (file.endsWith(".js.map") || file.endsWith(".d.ts"))
            continue;

        try {
            const { default: importedEvent } = await import(path.resolve(__dirname, "./events", file)) as { default: typeof BaseEvent };
            const meta = getEventMeta(importedEvent);
    
            if (meta) {
                await importedEvent.setup();
                const eventName = meta.eventName + "@" + (meta.repoName || "global");
                webhookServer.registeredEvents.set(eventName, importedEvent);
            }
        } catch (e) {
            console.log("Failed to load event %s:", file);
            console.log(e);
        }
    }
    
    discordBot.client.once("ready", async () => {
        if (!discordBot.client.isReady())
            return;

        const addCommandMeta: CommandMeta[] = [];

        for (const [ , command ] of discordBot.registeredCommands) {
            addCommandMeta.push(getCommandMeta(command)!);
        }

        const getCached = await getCommandsCached()
        const commandsHash = getCommandsHash(addCommandMeta);

        if (!getCached || !crypto.timingSafeEqual(getCached, commandsHash)) {
            await writeCommandsCached(commandsHash);
            console.log("Uploading commands..");

            if (discordBot.testingGuildId) {
                await discordBot.rest.put(
                    dtypes.Routes.applicationGuildCommands(discordBot.client.application.id, discordBot.testingGuildId),
                    {
                        body: addCommandMeta
                    }
                );
            } else {
                await discordBot.rest.put(
                    dtypes.Routes.applicationCommands(discordBot.client.application.id),
                    {
                        body: addCommandMeta
                    }
                );
            }
        }
        console.log("Client ready!");
    });
    
    discordBot.client.login(process.env.BOT_TOKEN as string);
    discordBot.rest.setToken(process.env.BOT_TOKEN as string || "");
})();