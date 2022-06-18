import github from "@octokit/rest";
import pino from "pino";

export class BaseEvent<RequestBody = any> {
    constructor(
        protected readonly githubClient: github.Octokit,
        protected readonly requestBody: RequestBody,
        protected readonly logger: pino.Logger,
        protected readonly accessToken: string
    ) {}

    static async setup() {}
    async execute() {}
}