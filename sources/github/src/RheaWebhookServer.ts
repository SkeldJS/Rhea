import express from "express";
import pino from "pino";
import pinoPretty from "pino-pretty";

import { webhook } from "./util";

export class RheaWebhookServer {
    expressServer: express.Express;
    logger: pino.Logger;

    constructor() {
        this.expressServer = express();
        this.logger = pino(pinoPretty());
        
        this.expressServer.use(express.json());

        this.expressServer.post("/rhea", webhook(), (req, res) => {
            console.log(req.body, req.header("X-GitHub-Event"));
            this.logger.info("Got webhook post");
        });
    }

    listen(port: number) {
        this.expressServer.listen(port);
        this.logger.info({ source: "listen", port }, "Listening on *:%s", port);
    }
}