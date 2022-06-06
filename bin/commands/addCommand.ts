import discord from "discord.js";

import {
    BaseCommand,
    Command,
    Execution,
    Components
} from "../../src";

@Command({
    name: "add",
    version: "1.0.0",
    description: "Keep adding a number llol"
})
export default class AddCommand extends BaseCommand {
    state: any;

    @Components.Button("Add One", "SUCCESS")
    async onAnother(interaction: discord.ButtonInteraction) {
        this.state += 1;

        await interaction.update({
            content: "Number: " + this.state
        });
    }

    @Execution()
    async onExec(interaction: discord.CommandInteraction) {
        const addOneButton = this.buttons.get("add-one")!;

        this.state = 1;

        await interaction.reply({
            content: "Number: " + this.state,
            components: [ new discord.MessageActionRow().addComponents(addOneButton) ]
        });
    }
}

