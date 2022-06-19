import webhooks from "@octokit/webhooks-types";
import { BaseEvent, Event } from "@skeldjs/rhea-github";

import path from "path";
import fs from "fs/promises";

import { runCommandInDir } from "../util/runCommandInDir";

const versionRegex = /^(\d+\.\d+\.\d+).+/;

@Event("SkeldJS/SkeldJS", "push")
export default class PushToSkeldjsEvent extends BaseEvent<webhooks.PushEvent> {
    async doesPackageExist(packageIdentifier: string) {
        try {
            await runCommandInDir(process.cwd(), "yarn info " + packageIdentifier);
            return true;
        } catch (e) {
            return false;
        }
    }

    async execute() {
        if (!this.requestBody.ref.includes("/tags")) {
            this.logger.info("No tags were pushed, doing nothing");
            return;
        }

        const tagPushed = this.requestBody.ref.split("/")[2];
        if (!versionRegex.test(tagPushed)) {
            this.logger.info("Bad tag pushed: %s", tagPushed);
            return;
        }

        const newSkeldjsVersion = tagPushed.match(versionRegex)![1];
        const baseHindenburgDir = path.resolve(__dirname, "Hindenburg");
        
        console.log("Resetting repository..");
        await runCommandInDir(baseHindenburgDir, "git fetch --all");
        await runCommandInDir(baseHindenburgDir, "git reset --hard HEAD");
        
        const packageJsonPath = path.resolve(baseHindenburgDir, "package.json");
        const changelogJsonPath = path.resolve(baseHindenburgDir, "changelog.json");
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        console.log("Updating skeldjs..");
        const dependencies = Object.keys(packageJson.dependencies);
        let flag = false;
        for (const dependencyName of dependencies) {
            if (dependencyName.startsWith("@skeldjs/")) {
                if (await this.doesPackageExist(dependencyName + "@" + newSkeldjsVersion)) {
                    packageJson.dependencies[dependencyName] = "^" + newSkeldjsVersion;
                    console.log("Updated %s to version %s", dependencyName, newSkeldjsVersion);
                    flag = true;
                } else {
                    console.log("Package doesn't exist: %s@%s", dependencyName, newSkeldjsVersion);
                }
            }
        }
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, undefined, 4), "utf8");

        if (!flag) {
            console.log("No packages updated, exiting..");
            return;
        }

        console.log("Installing updated packages..");
        await runCommandInDir(baseHindenburgDir, "yarn");
        
        if (!await runCommandInDir(baseHindenburgDir, "git diff")) { // if there were change
            console.log("There were no changes to made");
            return;
        }
        
        console.log("Configuring git credentials..");
        await runCommandInDir(baseHindenburgDir, "git config user.name " + process.env.GH_APP_USERNAME);
        await runCommandInDir(baseHindenburgDir, "git config user.email " + process.env.GH_APP_EMAIL);

        console.log("Committing..");
        await runCommandInDir(baseHindenburgDir, "git add package.json yarn.lock");
        await runCommandInDir(baseHindenburgDir, "git commit -m \"Update skeldJS to v" + newSkeldjsVersion + "\"");
        
        const lastCommitSha = await runCommandInDir(baseHindenburgDir, "git rev-parse HEAD");

        if (!lastCommitSha) {
            console.log("Couldn't get last commit");
            return;
        }
        
        console.log("Reading package.json and changelog.json..");
        let changelogJson = JSON.parse(await fs.readFile(changelogJsonPath, "utf8"));
        
        const [ major, minor, patch, ...rest ] = packageJson.version.split(".");
        const newHindenburgVersion = major + "." + minor + "." + (parseInt(patch) + 1) + "." + rest.join(".");
        
        packageJson.version = newHindenburgVersion;
        const date = new Date();
        delete changelogJson["$schema"];
        changelogJson = {
            "$schema": "./misc/changelog.schema.json", // cheats to put version at the start of the changelog
            [packageJson.version]: {
                version: newHindenburgVersion,
                contributors: ["Rhea"],
                date: date.getUTCFullYear().toString().padStart(4, "0") + "-" + date.getUTCMonth().toString().padStart(2, "0") + "-" + date.getUTCDay().toString().padStart(2, "0"),
                notes: [
                    {
                        description: "Update SkeldJS to v" + newSkeldjsVersion,
                        commits: [ lastCommitSha.trim() ]
                    }
                ]
            },
            ...changelogJson
        };
        console.log("Writing package.json and changelog.json..");
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, undefined, 4), "utf8");
        await fs.writeFile(changelogJsonPath, JSON.stringify(changelogJson, undefined, 4), "utf8");

        await runCommandInDir(baseHindenburgDir, "git add package.json changelog.json");
        await runCommandInDir(baseHindenburgDir, "git commit -m \"" + newHindenburgVersion + "\"");
        await runCommandInDir(baseHindenburgDir, "git tag -a \"" + newHindenburgVersion + "\n\n- Update SkeldJS to v" + newSkeldjsVersion + "\"");

        await runCommandInDir(baseHindenburgDir, "git push https://x-access-token:" + this.accessToken + "@github.com/SkeldJS/SkeldJS.git master " + newHindenburgVersion);

        await runCommandInDir(path.resolve(baseHindenburgDir, "scripts"), "yarn");
        await runCommandInDir(path.resolve(baseHindenburgDir, "scripts"), "node createPackages.js");

        const release = await this.githubClient.repos.createRelease({
            owner: "SkeldJS",
            repo: "SkeldJS",
            tag_name: newHindenburgVersion, 
            name: newHindenburgVersion,
            body: "- Update SkeldJS to v" + newSkeldjsVersion + " (" + lastCommitSha.trim() + ")"
        });
        
        await this.githubClient.repos.uploadReleaseAsset({
            release_id: release.data.id,
            owner: "SkeldJS",
            repo: "SkeldJS",
            name: "hindenburg-win.exe",
            data: await fs.readFile(path.resolve(baseHindenburgDir, "build", "hindenburg-win.exe"), "utf8"),
            mediaType: {
                format: "application/vnd.github.v3.raw"
            }
        });
        
        await this.githubClient.repos.uploadReleaseAsset({
            release_id: release.data.id,
            owner: "SkeldJS",
            repo: "SkeldJS",
            name: "hindenburg-linux",
            data: await fs.readFile(path.resolve(baseHindenburgDir, "build", "hindenburg-linux"), "utf8"),
            mediaType: {
                format: "application/vnd.github.v3.raw"
            }
        });
    }
}