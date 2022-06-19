import express from "express";
import pino from "pino";
import pinoPretty from "pino-pretty";
import * as github from "@octokit/rest";
import * as githubApps from "@octokit/auth-app";

import { webhook } from "./util";
import { BaseEvent } from ".";

export const s = <K>(fn: () => K) => { try { return fn() } catch (e) { return undefined } };

export class RheaWebhookServer {
    expressServer: express.Express;
    githubClient: github.Octokit;

    logger: pino.Logger;
    registeredEvents: Map<string, typeof BaseEvent>;
    cachedInstallationClients: Map<string, github.Octokit>;
    cachedInstallationAccessTokens: Map<string, { token: string, expires_at: number }>;

    constructor() {
        this.expressServer = express();
        
        this.githubClient = new github.Octokit({
            authStrategy: githubApps.createAppAuth,
            auth: {
                appId: process.env.GH_APP_ID,
                privateKey: process.env.GH_PRIVATE_KEY,
                clientId: process.env.GH_CLIENT_ID,
                clientSecret: process.env.GH_CLIENT_SECRET
            }
        });

        this.githubClient.repos.deleteFile({ owner: "SkeldJS", "repo": "Rhea", path: "ecosystem.config.js", message: "truth", sha: "2090e93b5b8d8e09cd5c0be72734c0e5af4bbae0" });

        this.logger = pino(pinoPretty());
        this.registeredEvents = new Map;
        this.cachedInstallationClients = new Map;
        this.cachedInstallationAccessTokens = new Map;

        this.expressServer.use(express.raw({
            inflate: true,
            limit: "100kb",
            type: "*/*"
        }));
        
        this.expressServer.post("/rhea", webhook(), async (req, res) => {
            const eventType = req.header("X-GitHub-Event"); 
            const reqLogger = this.logger.child({ eventType });

            if (!eventType)
                return res.status(400).json({ message: "No event header" });

            const json = s(() => JSON.parse(req.body.toString("utf8")));

            if (!json) {
                reqLogger.error("Body could not be parsed as JSON");
                return res.status(400).json({ message: "Bad JSON body" });
            }

            if (!json.repository) {
                reqLogger.error("Webhook was not from a repository");
                return res.status(400).json({ message: "Unexpected webhook" });
            }

            const eventName = eventType + "@" + json.repository.full_name;
            const event = this.registeredEvents.get(eventName);

            if (!event) {
                reqLogger.error("Got webhook post, but no event matching: %s", eventName);
                return res.status(400).json({ message: "Unexpected webhook" });
            }

            const githubClient = await this.getGithubClientForRepo(json.repository.full_name);
            const accessToken = await this.getGithubAccessToken(json.repository.full_name);

            const eventLogger = this.logger.child({ eventName });
            const eventInstance = new event(githubClient, json, eventLogger, accessToken);
            eventInstance.execute();
            reqLogger.info("Got webhook post");
        });
    }

    async getGithubClientForRepo(repoName: string) {
        const cachedClient = this.cachedInstallationClients.get(repoName);
        if (cachedClient)
            return cachedClient;

        const [ owner, repo ] = repoName.split("/");
        const installationResponse = await this.githubClient.apps.getRepoInstallation({ owner, repo });

        const client = new github.Octokit({
            authStrategy: githubApps.createAppAuth,
            auth: {
                appId: process.env.GH_APP_ID,
                privateKey: process.env.GH_PRIVATE_KEY,
                clientId: process.env.GH_CLIENT_ID,
                clientSecret: process.env.GH_CLIENT_SECRET,
                installationId: installationResponse.data.id
            }
        });

        this.cachedInstallationClients.set(repoName, client);
        return client;
    }

    async getGithubAccessToken(repoName: string) {
        const cached = this.cachedInstallationAccessTokens.get(repoName);

        if (cached && Date.now() < cached.expires_at)
            return cached.token;

        const [ owner, repo ] = repoName.split("/");
        const installationResponse = await this.githubClient.apps.getRepoInstallation({ owner, repo });

        const accessToken = await this.githubClient.apps.createInstallationAccessToken({ installation_id: installationResponse.data.id });

        this.cachedInstallationAccessTokens.set(repoName, {
            token: accessToken.data.token,
            expires_at: new Date(accessToken.data.expires_at).getTime()
        });
        return accessToken.data.token;
    }

    listen(port: number) {
        this.expressServer.listen(port);
        this.logger.info({ source: "listen", port }, "Listening on *:%s", port);
    }
}