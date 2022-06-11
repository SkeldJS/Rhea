import { ApplicationCommandOptionType } from "discord-api-types";
import sourceMap from "source-map";
import discord from "discord.js";
import fs from "fs/promises";
import path from "path";
import fuse from "fuse.js";

import {
    BaseCommand,
    Command,
    Components,
    Execution
} from "../../src";

interface SymbolSourceInfo {
    fileName: string;
    line: number;
    character: number;
}

interface SymbolLocationInfo {
    fileName: string;
    url: string;
    package: string;
    line: number;
    column: number;
}

interface SymbolDocsState {
    symbols: any[];
    selectedDefinitionIdx: number;
}

const mdnLinks: Record<string, string> = {
    "string": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String",
    "number": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number",
    "boolean": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean",
    "void": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/undefined",
    "Promise": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
    "any": "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#any"
}

const hindenburgBaseUrl = "https://github.com/SkeldJS/Hindenburg";
const skeldjsBaseUrl = "https://github.com/SkeldJS/SkeldJS";

const docsBaseUrl = "https://skeldjs.github.io/Hindenburg";

function addZeroWidthSpaces(text: string) {
    return text.replace(/``/g, "`​`");
}

@Command({
    name: "docs",
    version: "1.0.0",
    description: "Get the docs entry for a Hindenburg class, method, function, etc.",
    options: [
        {
            type: ApplicationCommandOptionType.String,
            name: "symbol",
            description: "The symbol to get documentation for"
        },
        {
            type: ApplicationCommandOptionType.Boolean,
            name: "display",
            description: "Whether or not other people can see this message"
        }
    ]
})
export default class DocsCommand extends BaseCommand {
    static docsJson: any;
    static docsIdToSymbolsMap: Map<number, any[]> = new Map;

    state!: SymbolDocsState;

    static findIdentifierInChildren(parentSymbol: any, identifier: string) {
        const matching = new fuse<any>(parentSymbol.children, {
            keys: ["name"],
            threshold: 0.2
        });
        return matching.search(identifier)[0]?.item;
    }

    static getIdentifierInChildren(parentSymbol: any, identifier: string) {
        return parentSymbol.children.find((child: any) => child.name === identifier);
    }
    
    static findIdentifierRecursive(parentSymbol: any, identifier: string, exact = false): any[]|undefined {
        const propAccessIdx = identifier.indexOf(".");
    
        if (propAccessIdx === -1) {
            const childSymbol = exact
                ? this.getIdentifierInChildren(parentSymbol, identifier)
                : this.findIdentifierInChildren(parentSymbol, identifier);

            if (!childSymbol)
                return undefined;

            return [ childSymbol ];
        }
    
        const base = identifier.substring(0, propAccessIdx);
        const access = identifier.substring(propAccessIdx + 1);
    
        const baseSymbol = exact
            ? this.getIdentifierInChildren(parentSymbol, base)
            : this.findIdentifierInChildren(parentSymbol, base);
    
        if (!baseSymbol || !baseSymbol.children)
            return undefined;

        const accessSymbols = this.findIdentifierRecursive(baseSymbol, access, exact);

        if (!accessSymbols)
            return undefined;
    
        return [ baseSymbol, ...accessSymbols ];
    }

    static async generateLocation(source: SymbolSourceInfo, treeId = "master"): Promise<SymbolLocationInfo> {
        if (source.fileName.startsWith("node_modules/@skeldjs/")) {
            if (!source.fileName.endsWith(".d.ts"))
                throw new Error("Source file name was not a declaration file");
            
            const distIdx = source.fileName.indexOf("/dist/");
            const originalPath = path.dirname(source.fileName.substring(distIdx + 6));
            const originalFilename = path.join(originalPath, path.basename(source.fileName, ".d.ts") + ".ts").replace(/\\/g, "/");
    
            const packageName = source.fileName.substring(22, distIdx);
    
            const sourceFileNameBase = path.basename(source.fileName, ".d.ts");
            const sourceMapFileName = path.join(process.cwd(), "Hindenburg", "node_modules", "@skeldjs", packageName, "dist", originalPath, sourceFileNameBase + ".d.ts.map");
            try {
                const sourceMapFileData = await fs.readFile(sourceMapFileName, "utf8");
                const sourceMapConsumer = await new sourceMap.SourceMapConsumer(JSON.parse(sourceMapFileData));
    
                try {
                    const originalPosition = sourceMapConsumer.originalPositionFor({ line: source.line, column: source.character });

                    if (originalPosition.line === null || originalPosition.column === null)
                        throw new Error("No original file equivalent of symbol source in declaration file");

                    sourceMapConsumer.destroy();

                    return {
                        fileName: originalFilename,
                        url: `${skeldjsBaseUrl}/blob/${treeId}/packages/${packageName}/${originalFilename}#L${originalPosition.line}`,
                        package: "@skeldjs/" + packageName,
                        line: originalPosition.line,
                        column: originalPosition.column
                    };
                } catch (e) {
                    sourceMapConsumer.destroy();
                    throw e;
                }
            } catch (e: any) {
                if (e.code === "ENOENT") {
                    throw new Error("No source map for declaration file");
                }
    
                throw e;
            }
        }

        return {
            fileName: source.fileName,
            url: hindenburgBaseUrl + "/blob/" + treeId + "/" + source.fileName,
            package: "@skeldjs/hindenburg",
            line: source.line,
            column: source.character
        };
    }

    static async setup() {
        this.docsJson = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "Hindenburg", "docs", "out.json"), "utf8"));
        this.assignIdsToSymbolMapRecursive(this.docsJson, []);
    }

    static assignIdsToSymbolMapRecursive(symbol: any, parents: any[]) {
        const arrayProps = [ "parameters", "children", "typeParameter" ];

        for (const arrayProp of arrayProps) {
            if (symbol[arrayProp] && Array.isArray(symbol[arrayProp])) {
                for (const child of symbol[arrayProp]) {
                    if (child.id) {
                        const symbolPath = [ ...parents, child ];
                        this.docsIdToSymbolsMap.set(child.id, symbolPath);
                        this.assignIdsToSymbolMapRecursive(child, symbolPath);
                    }
                }
            }
        }
    }

    static getDocsLink(symbols: any[]) {
        const symbol = symbols[0];
        switch (symbol.kindString) {
            case "Class":
                if (symbols.length > 1) {
                    const property = symbols[1];
                    return `${docsBaseUrl}/classes/${symbol.name}#${property.name}`;
                }
                return `${docsBaseUrl}/classes/${symbol.name}`;
            case "Interface":
                if (symbols.length > 1) {
                    const property = symbols[1];
                    return `${docsBaseUrl}/interfaces/${symbol.name}#${property.name}`;
                }
                return `${docsBaseUrl}/interfaces/${symbol.name}`;
            case "Enumeration":
                if (symbols.length > 1) {
                    const property = symbols[1];
                    return `${docsBaseUrl}/enums/${symbol.name}#${property.name}`;
                }
                return `${docsBaseUrl}/enums/${symbol.name}`;
            case "Type alias":
            case "Variable":
            case "Function":
                return `${docsBaseUrl}/modules.html#${symbol.mame}`;
        }
    }

    getDefinitions(symbol: any) {
        switch (symbol.kindString) {
            case "Method":
                return symbol.signatures;
            case "Class":
                return [ symbol ];
            case "Property":
                return [ symbol ];
            case "Enumeration":
                return [ symbol ];
            case "Enumeration member":
                return [ symbol ];
            case "Interface":
                return [ symbol ];
            case "Variable":
                return [ symbol ];
            case "Function":
                return symbol.signatures;
            case "Type alias":
                return [ symbol ];
        }
        return [];
    }

    renderReflection(reflection: any, isReturnType = false): string {
        switch (reflection.kindString) {
            case "Type literal":
                return this.renderReflection(reflection.signatures[0], isReturnType);
            case "Call signature":
                let out = "`";
                out += "(";
                if (reflection.parameters) {
                    out += reflection.parameters.map((parameter: any) => parameter.name + ": `" + this.renderType(parameter.type, isReturnType)).join("`, ");
                    out += "`) => `";
                } else {
                    out += ") => `";
                }
                out += this.renderType(reflection.type, isReturnType);
                return out;
            default:
                return "`?`";
        }
    }

    renderType(type: any, isReturnType = false, maskName?: string): string {
        switch (type.type) {
            case "reference":
                if (type.typeArguments) {
                    let out = this.renderType({ type: type.type, name: type.name }, isReturnType);
                    out += "`<`";
                    out += type.typeArguments.map((type: any) => this.renderType(type, isReturnType)).join("`, `");
                    out += "`>`";
                    return out;
                }

                const symbols = DocsCommand.docsIdToSymbolsMap.get(type.id) || DocsCommand.findIdentifierRecursive(DocsCommand.docsJson, type.name, true);

                if (!symbols)
                    return this.renderType({ type: "intrinsic", name: type.name }, isReturnType);

                const hindenburgDocsLink = DocsCommand.getDocsLink(symbols);
                return `[\`${maskName || type.name}\`](${hindenburgDocsLink})`;
            case "intrinsic":
                const mdnLink = mdnLinks[type.name];

                if (!mdnLink)
                    return `\`${maskName || type.name}\``;

                return `[\`${maskName || type.name}\`](${mdnLink})`;
            case "literal":
                if (typeof type.value === "string") {
                    return `\`"${type.value}"\``;
                }
                return `\`${type.value}\``;
            case "union":
                if (type.types.length > 10) {
                    return type.types.slice(0, 10).map((type: any) => this.renderType(type, isReturnType)).join("`|`") + "`| ...`";
                }
                return type.types.map((type: any) => this.renderType(type, isReturnType)).join("`|`");
            case "intersection":
                if (type.types.length > 10) {
                    return type.types.slice(0, 10).map((type: any) => this.renderType(type, isReturnType)).join("`&`") + "`& ...`";
                }
                return type.types.map((type: any) => this.renderType(type, isReturnType)).join("`&`");
            case "query":
                return "`typeof `" + this.renderType(type.queryType, isReturnType);
            case "predicate":
                if (isReturnType) {
                    return this.renderType({ type: "intrinsic", name: "boolean" }, isReturnType);
                }

                return "`" + type.name + " is `" + this.renderType(type.targetType, isReturnType);
            case "reflection":
                return this.renderReflection(type.declaration, isReturnType);
            case "indexedAccess":
                return this.renderType(type.objectType, isReturnType) + "`[`" + this.renderType(type.indexType, isReturnType) + "`]`";
            case "array":
                return this.renderType(type.elementType, isReturnType) + "`[]`";
            case "tuple":
                return `\`[\`${type.elements.map((element: any) => this.renderType(element, isReturnType)).join(`\`, \``)}\`]\``;
            default:
                return "`?`";
        }
    }

    formatCommentText(text: string) {
        return text.replace(/{@link ([a-zA-Z$_]+(\.[a-zA-Z$_]+)*)( ?\| ?(.+?))?}/g, (rep: string, ...groups: any[]) => {
            const maskName = groups[3]?.trim() || groups[0];
            const symbolName = groups[0];

            return this.renderType({ type: "reference", name: symbolName });
        }).replace(/(?<!\n)\n/g, " ");
    }

    renderDefinition(symbol: any, definition: any) {
        switch (symbol.kindString) {
            case "Method":
            case "Function": {
                let out = "`";
                if (symbol.flags?.isStatic) {
                    out += "static ";
                }
                out += definition.name;
                if (definition.typeParameter) {
                    out += "<";
                    out += definition.typeParameter.map((type: any) => type.name + (type.type ? " extends `" + this.renderType(type.type) + "`" : "")).join("`, ");
                    out += ">";
                }
                out += "(";
                if (definition.parameters) {
                    out += definition.parameters.map((parameter: any) => parameter.name + ": `" + this.renderType(parameter.type)).join("`, ");
                    out += "`): `";
                } else {
                    out += "): `";
                }
                out += this.renderType(definition.type);
                return out;
            }
            case "Class": {
                let out = "`class ";
                out += symbol.name;
                if (definition.typeParameter) {
                    out += "<";
                    out += definition.typeParameter.map((type: any) => type.name + (type.type ? " extends `" + this.renderType(type.type) + "`" : "")).join("`, ");
                    out += ">";
                }
                if (definition.extendedTypes) {
                    out += " extends `";
                    out += definition.extendedTypes.map((type: any) => this.renderType(type)).join("`, ");
                    out += "` {}`";
                } else {
                    out += " {}`";
                }
                return out;
            }
            case "Property":
                return `\`${symbol.flags?.isStatic ? "static " : ""}${symbol.name}: \`${this.renderType(symbol.type)}`;
            case "Enumeration":
                return `\`enum ${symbol.name} {}\``;
            case "Enumeration member":
                return `\`${symbol.name} = ${definition.defaultValue}\``;
            case "Interface":
                return `\`interface ${symbol.name} {}\``;
            case "Variable":
                return `\`${symbol.flags?.isConst ? "const" : "let"} ${symbol.name}: \`${this.renderType(symbol.type)}`;
            case "Type alias":
                return `\`type ${symbol.name} = \`${this.renderType(symbol.type)}`;
        }

        return "`?`";
    }

    getInheritanceDepth(symbol: any): number {
        if (!symbol.inheritedFrom || symbol.inheritedFrom.type !== "reference") {
            return 0;
        }

        const inheritedFrom = DocsCommand.docsIdToSymbolsMap.get(symbol.inheritedFrom.id) || DocsCommand.findIdentifierRecursive(DocsCommand.docsJson, symbol.inheritedFrom.name);

        if (!inheritedFrom)
            return 1;

        return 1 + this.getInheritanceDepth(inheritedFrom[inheritedFrom.length - 1]);
    }

    rankOnInheritance(symbols: any[]) {
        return [...symbols].sort((a, b) => this.getInheritanceDepth(a) - this.getInheritanceDepth(b));
    }

    renderSymbol(symbol: any, definitionIdx: number, embed: discord.MessageEmbed) {
        const definitions = this.getDefinitions(symbol);
        const definition = definitions[definitionIdx];

        if (!definition)
            return;

        embed.setDescription(addZeroWidthSpaces(this.renderDefinition(symbol, definition)));
        
        if (definition.comment?.shortText || definition.comment?.text) {
            const description = addZeroWidthSpaces(this.formatCommentText((definition.comment?.shortText || "") + "\n\n" + (definition.comment?.text || "")).trim());
            embed.addField("Description", description);
        }

        const returnsComment = definition.comment?.returns;
        const examples = definition.comment?.tags?.filter((tag: any) => tag.tag === "example") || [];
        switch (symbol.kindString) {
            case "Method":
            case "Function":
                if (definition.parameters) {
                    embed.addField("Parameters", addZeroWidthSpaces(definition.parameters.map((parameter: any) => {
                        return `**${parameter.name}${parameter.flags?.isOptional ? "?" : ""}: ${this.renderType(parameter.type)}**${parameter.comment?.text ? " - " + parameter.comment.text : ""}`;
                    }).join("\n")));
                }
                embed.addField("Return Type", addZeroWidthSpaces(`${this.renderType(definition.type, true)}${returnsComment ? " - " + returnsComment : ""}`));
                break;
            case "Class":
            case "Interface":
                const methods = symbol.children?.filter((child: any) => child.kindString === "Method");
                const properties = symbol.children?.filter((child: any) => child.kindString === "Property");

                if (methods?.length) {
                    const methodsRanked = this.rankOnInheritance(methods);
                    
                    if (methodsRanked.length > 50) {
                        embed.addField("Properties", methodsRanked.slice(0, 50).map((methodSymbol: any) => {
                            const docsLink = DocsCommand.getDocsLink([ symbol, methodSymbol ]);
                            return `\`${methodSymbol.name}\``//`[\`${methodSymbol.name}\`](${docsLink})`;
                        }).join(", ") + ", ...");
                    } else {
                        embed.addField("Properties", methodsRanked.map((methodSymbol: any) => {
                            const docsLink = DocsCommand.getDocsLink([ symbol, methodSymbol ]);
                            return `\`${methodSymbol.name}\``//`[\`${propertySymbol.name}\`](${docsLink})`;
                        }).join(", "));
                    }
                }

                if (properties?.length) {
                    const propertiesRanked = this.rankOnInheritance(properties);

                    if (propertiesRanked.length > 50) {
                        embed.addField("Properties", propertiesRanked.slice(0, 50).map((propertySymbol: any) => {
                            const docsLink = DocsCommand.getDocsLink([ symbol, propertySymbol ]);
                            return `\`${propertySymbol.name}\``//`[\`${propertySymbol.name}\`](${docsLink})`;
                        }).join(", ") + "...");
                    } else {
                        embed.addField("Properties", propertiesRanked.map((propertySymbol: any) => {
                            const docsLink = DocsCommand.getDocsLink([ symbol, propertySymbol ]);
                            return `\`${propertySymbol.name}\``//`[\`${propertySymbol.name}\`](${docsLink})`;
                        }).join(", "));
                    }
                }
                break;
            case "Property":
                break;
            case "Enumeration":
                if (symbol.children.length) {
                    embed.addField("Members", symbol.children.map((enumMember: any) => {
                        const docsLink = DocsCommand.getDocsLink([ symbol, enumMember ]);
                        return `\`${enumMember.name}\``;// `[\`${enumMember.name}\`](${docsLink})}`;
                    }).join(", "));
                }
                break;
            case "Enumeration member":
                embed.addField("Value", definition.defaultValue);
                break;
            case "Variable":
                break;
            case "Type alias":
                break;
        }
        
        for (const example of examples) {
            embed.addField("Example", example.text);
        }
    }

    @Components.Button("Next Definition", "PRIMARY")
    async onNextDefinition(interaction: discord.ButtonInteraction) {
        const definitions = this.getDefinitions(this.state.symbols[this.state.symbols.length - 1]);
        
        const nextDefinitionButton = this.buttons.get("next-definition")!;
        const previousDefinitionButton = this.buttons.get("previous-definition")!;

        this.state.selectedDefinitionIdx++;

        nextDefinitionButton.setDisabled(this.state.selectedDefinitionIdx === definitions.length - 1);
        previousDefinitionButton.setDisabled(this.state.selectedDefinitionIdx === 0);
        
        await interaction.update({
            embeds: [ await this.createEmbed(this.state.symbols) ],
            components: [
                new discord.MessageActionRow()
                    .addComponents(previousDefinitionButton, nextDefinitionButton)
            ]
        });
    }

    @Components.Button("Previous Definition", "PRIMARY")
    async onPreviousDefinition(interaction: discord.ButtonInteraction) {
        const definitions = this.getDefinitions(this.state.symbols[this.state.symbols.length - 1]);

        const nextDefinitionButton = this.buttons.get("next-definition")!;
        const previousDefinitionButton = this.buttons.get("previous-definition")!;

        this.state.selectedDefinitionIdx--;

        nextDefinitionButton.setDisabled(this.state.selectedDefinitionIdx === definitions.length - 1);
        previousDefinitionButton.setDisabled(this.state.selectedDefinitionIdx === 0);
        
        await interaction.update({
            embeds: [ await this.createEmbed(this.state.symbols) ],
            components: [
                new discord.MessageActionRow()
                    .addComponents(previousDefinitionButton, nextDefinitionButton)
            ]
        });
    }

    async createEmbed(symbols: any[]) {
        const beginTime = Date.now();
        const docsLink = DocsCommand.getDocsLink(symbols);
        const symbol = symbols[symbols.length - 1];

        const sources = await Promise.all(symbol.sources.map(async (source: any) => {
            const location = await DocsCommand.generateLocation(source, "master");
            return `**${location.package}**: [\`${location.fileName}:${location.line}:${location.column}\`](${location.url})`;
        }));

        const definitions = this.getDefinitions(symbol);

        const embed = new discord.MessageEmbed()
            .setTitle("📘 Docs for " + symbols.map((symbol: any) => symbol.name).join(".") + " (Definition " + (this.state.selectedDefinitionIdx + 1) + "/" + definitions.length + ")");

        this.renderSymbol(symbol, this.state.selectedDefinitionIdx, embed);

        embed.addField("Implemented in:", sources.join("\n"));

        const endTime = Date.now();
        embed.setFooter(`Rendered embed in ${endTime - beginTime}ms`);

        if (docsLink)
            embed.setURL(docsLink);

        return embed;
    }

    @Execution()
    async onExec(interaction: discord.CommandInteraction) {
        const symbolIdentifier = interaction.options.getString("symbol", false);

        if (symbolIdentifier === null) {
            return await interaction.reply({
                embeds: [
                    new discord.MessageEmbed()
                        .setTitle("📘 Docs")
                        .setColor(0x33609b)
                        .setDescription("Visit the docs at https://skeldjs.github.io/Hindenburg")
                ],
                ephemeral: !(interaction.options.getBoolean("display") || false)
            });
        }

        const symbols = DocsCommand.findIdentifierRecursive(DocsCommand.docsJson, symbolIdentifier);

        if (!symbols) {
            return await interaction.reply({
                embeds: [
                    new discord.MessageEmbed()
                        .setTitle("❌ Symbol does not exist: " + symbolIdentifier)
                        .setColor(0xe54f47)
                        .setDescription("Visit the docs at https://skeldjs.github.io/Hindenburg")
                ],
                ephemeral: true
            });
        }
        
        this.state = {
            symbols,
            selectedDefinitionIdx: 0
        };

        const definitions = this.getDefinitions(symbols[symbols.length - 1]);

        if (definitions.length > 1) {
            const nextDefinitionButton = this.buttons.get("next-definition")!;
            const previousDefinitionButton = this.buttons.get("previous-definition")!;

            nextDefinitionButton.setDisabled(this.state.selectedDefinitionIdx === definitions.length - 1);
            previousDefinitionButton.setDisabled(this.state.selectedDefinitionIdx === 0);
            
            await interaction.reply({
                embeds: [ await this.createEmbed(symbols) ],
                components: [
                    new discord.MessageActionRow()
                        .addComponents(previousDefinitionButton, nextDefinitionButton)
                ],
                ephemeral: !(interaction.options.getBoolean("display") || false)
            });
        } else {
            await interaction.reply({
                embeds: [ await this.createEmbed(symbols) ],
                ephemeral: !(interaction.options.getBoolean("display") || false)
            });
        }
    }
}

