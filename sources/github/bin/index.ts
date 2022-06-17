import dotenv from "dotenv";
dotenv.config();

import { RheaWebhookServer } from "../src";

const server = new RheaWebhookServer;
server.listen(process.env.PORT ? parseInt(process.env.PORT) : 8000);