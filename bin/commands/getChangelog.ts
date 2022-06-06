import { ApplicationCommandOptionType } from "discord-api-types";
import discord, { MessageActionRow, MessageEmbed } from "discord.js";
import got from "got";

import {
    BaseCommand,
    Command,
    Execution,
    Components
} from "../../src";

export interface VersionChangeLogNote {
    description: string;
    commits: string[];
}

export interface VersionChangeLog {
    version: string;
    contributors: string[];
    date: string;
    notes: VersionChangeLogNote[];
}

export interface ChangeLogState {
    versions: Record<string, VersionChangeLog>;
    currentVersion: string;
}

@Command({
    name: "changelog",
    version: "1.0.0",
    description: "Get the change log details of a specific version of Hindenburg",
    options: [
        {
            type: ApplicationCommandOptionType.String,
            name: "version",
            description: "The version of Hindenburg to get change log details for",
            required: false
        }
    ]
})
export default class ChangeLogCommand extends BaseCommand {
    state!: ChangeLogState;

    @Components.Button("Next", "PRIMARY")
    async onNext(interaction: discord.ButtonInteraction) {
        const allVersions = Object.keys(this.state.versions);
        const currentVersionIdx = allVersions.indexOf(this.state.currentVersion);

        const nextVersion = currentVersionIdx <= 0
            ? allVersions[0]
            : allVersions[currentVersionIdx - 1];

        const versionLog = this.state.versions[nextVersion];
        this.state.currentVersion = versionLog.version;

        await interaction.update(this.createMessageForVersion(versionLog));
    }

    @Components.Button("Previous", "PRIMARY")
    async onPrevious(interaction: discord.ButtonInteraction) {
        const allVersions = Object.keys(this.state.versions);
        const currentVersionIdx = allVersions.indexOf(this.state.currentVersion);

        const previousVersion = currentVersionIdx >= allVersions.length - 1
            ? allVersions[allVersions.length - 1]
            : allVersions[currentVersionIdx + 1];

        const versionLog = this.state.versions[previousVersion];
        this.state.currentVersion = versionLog.version;

        await interaction.update(this.createMessageForVersion(versionLog));
    }

    createMessageForVersion(versionLog: VersionChangeLog): discord.InteractionUpdateOptions {
        const allVersions = Object.keys(this.state.versions);
        const nextButton = this.buttons.get("next")!;
        const previousButton = this.buttons.get("previous")!;

        nextButton.setDisabled(versionLog.version === allVersions[0]);
        previousButton.setDisabled(versionLog.version === allVersions[allVersions.length - 1]);

        return {
            embeds: [
                new discord.MessageEmbed()
                .setTitle("📜 Changelog for: " + versionLog.version)
                .setColor(0x33609b)
                .setDescription(
                    versionLog.notes.map(note => {
                        return "**-** `" + note.description + "` (" + note.commits.map(commit => {
                            return `[${commit.substring(0, 7)}](https://github.com/skeldjs/Hindenburg/commit/${commit})`
                        }).join(", ") + ")"
                    }).join("\n"))
            ],
            components: [
                new MessageActionRow()
                    .addComponents(nextButton, previousButton)
            ]
        }
    }

    @Execution()
    async onExec(interaction: discord.CommandInteraction) {
        try {
            const changelog = await got.get("https://raw.githubusercontent.com/SkeldJS/Hindenburg/master/changelog.json").json() as Record<string, VersionChangeLog>;
            delete changelog["$schema"];
            const allVersions = Object.keys(changelog);

            const version = interaction.options.getString("version") || allVersions[0];

            const versionLog = changelog[version];
            if (!versionLog) {
                return await interaction.reply({
                    embeds: [
                        new MessageEmbed()
                            .setTitle("❌ Version does not exist: " + version)
                            .setColor(0xe54f47)
                    ]
                });
            }

            this.state = {
                versions: changelog,
                currentVersion: version
            }
            await interaction.reply(this.createMessageForVersion(versionLog) as discord.InteractionReplyOptions);
        } catch (e) {
            if (e instanceof got.HTTPError) {
                return await interaction.reply({
                    embeds: [
                        new MessageEmbed()
                            .setTitle("❌ Failed to get changelog")
                            .setColor(0xe54f47)
                            .setDescription("Couldn't get changelog from github repo, status code: `" + e.response.statusCode + "`")
                    ]
                });
            }

            throw e;
        }
    }
}

