import path from "path";
import fs from "fs/promises";

import { runCommandInDir } from "./sources/bin/src/util/runCommandInDir";

const tagPushed = "2.15.25";
const versionRegex = /^(\d+\.\d+\.\d+)( .+)?/;

async function doesPackageExist(packageIdentifier: string) {
    try {
        await runCommandInDir(process.cwd(), "yarn npm info " + packageIdentifier);
        return true;
    } catch (e) {
        console.log(e);
        return false;
    }
}

(async () => {
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
            if (await doesPackageExist(dependencyName + "@" + newSkeldjsVersion)) {
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
    await runCommandInDir(baseHindenburgDir, "git commit -m \"Update skeldjs to v" + newSkeldjsVersion + "\"");
    
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
                    description: "Update skeldjs to v" + newSkeldjsVersion,
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
    await runCommandInDir(baseHindenburgDir, "git tag -a \"" + newHindenburgVersion + "\n\n- Update skeldjs to v" + newSkeldjsVersion + "\"");
    await runCommandInDir(baseHindenburgDir, "git push https://x-access-token:" + this.);
})();