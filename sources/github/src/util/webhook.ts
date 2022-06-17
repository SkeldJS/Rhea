import express from "express";
import pino from "pino";
import crypto from "crypto";
import pinoPretty from "pino-pretty";

const logger = pino(pinoPretty());
logger.setBindings({ source: "webhook" });

export function webhook() {
    return function(req: express.Request, res: express.Response, next: express.NextFunction) {
        if (!req.header("User-Agent")?.startsWith("GitHub-Hookshot/")) {
            logger.debug({ user_agent: req.header("User-Agent") }, "Got webhook post, but user-agent was invalid");
            res.status(400).json({ message: "Invalid User-Agent" });
            return;
        }
    
        if (!process.env.GH_WEBHOOK_SECRET)
            return next();
        
        const hmacVerify = crypto.createHmac("sha256", process.env.GH_WEBHOOK_SECRET as string);
        hmacVerify.write(req.body);
        const computedSha256 = hmacVerify.digest();
    
        const receivedSha256Str = req.header("X-Hub-Signature-256")?.split("=")[1];
    
        if (!receivedSha256Str) {
            logger.debug({ headers: Object.keys(req.headers) }, "Got webhook post, but request wasn't signed");
            res.status(400).json({ message: "Request not signed" });
            return;
        }
        
        const receivedSha256 = Buffer.from(receivedSha256Str, "hex");
    
        if (!crypto.timingSafeEqual(computedSha256, receivedSha256)) {
            logger.debug({ computed_sha256: computedSha256, received_sha256: receivedSha256 }, "Got webhook post, but the signature was invalid");
            res.status(400).json({ message: "Invalid signature" });
            return;
        }
    
        next();
    }
}