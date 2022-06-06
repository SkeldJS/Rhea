import "reflect-metadata";

import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";

import * as dtypes from "discord-api-types/v9";

dotenv.config({
    path: path.resolve(process.cwd(), ".env")
});

import { BaseCommand, CommandMeta, getCommandMeta, RheaBot } from "../src";

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
    const bot = new RheaBot({
        postgres: {
            host: process.env.POSTGRES_HOST as string || "127.0.0.1",
            port: parseInt(process.env.POSTGRES_PORT || "5379"),
            username: process.env.POSTGRES_USER || "admin",
            password: process.env.POSTGRES_PASSWORD || "1234",
            database: process.env.POSTGRES_DATABASE || "postgres",
            ssl: "require"
        },
        redis: {
            host: process.env.REDIS_HOST as string || "127.0.0.1",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            password: process.env.REDIS_PASSWORD as string|undefined
        }
    }, process.env.GUILD_ID as string|undefined);

    const files = await fs.readdir(path.resolve(__dirname, "./commands"));
    for (const file of files) {
        if (file.endsWith(".js.map") || file.endsWith(".d.ts"))
            continue;

        try {
            const { default: importedCommand } = await import(path.resolve(__dirname, "./commands", file)) as { default: typeof BaseCommand };
            const meta = getCommandMeta(importedCommand);
    
            if (meta) {
                bot.registeredCommands.set(meta.name, importedCommand);
            }
        } catch (e) {
            console.log("Failed to load %s:", file);
            console.log(e);
        }
    }
    
    bot.client.once("ready", async () => {
        if (!bot.client.isReady())
            return;

        const addCommandMeta: CommandMeta[] = [];

        for (const [ , command ] of bot.registeredCommands) {
            addCommandMeta.push(getCommandMeta(command)!);
        }

        const getCached = await getCommandsCached()
        const commandsHash = getCommandsHash(addCommandMeta);

        if (!getCached || !crypto.timingSafeEqual(getCached, commandsHash)) {
            await writeCommandsCached(commandsHash);
            console.log("Uploading commands..");

            if (bot.testingGuildId) {
                await bot.rest.put(
                    dtypes.Routes.applicationGuildCommands(bot.client.application.id, bot.testingGuildId),
                    {
                        body: addCommandMeta
                    }
                );
            } else {
                await bot.rest.put(
                    dtypes.Routes.applicationCommands(bot.client.application.id),
                    {
                        body: addCommandMeta
                    }
                );
            }
        }
        console.log("Client ready!");
    });
    
    bot.client.login(process.env.BOT_TOKEN as string);
    bot.rest.setToken(process.env.BOT_TOKEN as string || "");
})();