import postgres from "postgres";
import ioredis from "ioredis";
import crypto from "crypto";
import got from "got";

import * as dtypes from "discord-api-types/v9";
import { REST } from "@discordjs/rest";

import { Cache } from "./util/Cache";

import { RedisChannels } from "./types";
import { Account, AccountConnection, InteractionState, SessionId } from "./structures";

export interface PostgresConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    ssl: "require"|"prefer"|boolean|object;
}

export interface RedisConfig {
    port: number;
    host: string;
    password: string;
}

export class RheaDatabaseConnection {
    private postgresConnection: postgres.Sql<{}>;
    private redisPubConnection: ioredis.Redis;
    private redisSubConnection: ioredis.Redis;

    private cache: Cache;

    private randomBuffer: Buffer;

    constructor(postgresConfig: Partial<PostgresConfig> = {}, redisConfig: Partial<RedisConfig> = {}) {
        this.postgresConnection = postgres({
            host: "127.0.0.1",
            port: 5432,
            username: "admin",
            password: "1234",
            database: "postgres",
            ssl: "prefer",
            ...postgresConfig
        });

        this.postgresConnection()

        this.redisPubConnection = new ioredis(
            redisConfig.port || 6379,
            redisConfig.host || "127.0.0.1",
            {
                password: redisConfig.password
            }
        );

        this.redisSubConnection = new ioredis(
            redisConfig.port || 6379,
            redisConfig.host || "127.0.0.1",
            {
                password: redisConfig.password
            }
        );

        this.cache = new Cache(this.redisPubConnection);
        this.randomBuffer = Buffer.alloc(32);

        this.redisSubConnection.subscribe(RedisChannels.CacheInvalidation);
        this.redisSubConnection.on("message", async (channel: string, message: string) => {
            if (channel === RedisChannels.CacheInvalidation) {
                await this.cache.invalidateCached(message, false);
            }
        });
    }

    generateRandomHash() {
        return new Promise<string>((resolve, reject) => {
            crypto.randomFill(this.randomBuffer, (err, buf) => {
                if (err) {
                    return reject(err);
                }

                const sha256Hash = crypto.createHash("sha256").update(buf);
                resolve(sha256Hash.digest("hex"));
            });
        });
    }

    async getSessions(user: string|Account): Promise<SessionId[]> {
        const userId = typeof user === "string" ? user : user.user_id;

        const cachedSessions = this.cache.getCached<SessionId[]>(`sessions.${userId}`);
        if (cachedSessions)
            return cachedSessions;

        const sessionRows = await this.postgresConnection`
            SELECT *
            FROM session_ids
            WHERE discord_user_id = ${userId}
        `;

        this.cache.setCached(`sessions.${userId}`, sessionRows, 5);
        return Array.from(sessionRows) as SessionId[];
    }

    async getSession(sessionId: string): Promise<SessionId|undefined> {
        if (sessionId === "")
            return undefined;

        const cachedSession = this.cache.getCached<SessionId>(`session.${sessionId}`);
        if (cachedSession)
            return cachedSession === null ? undefined : cachedSession;

        const sessionRows = await this.postgresConnection`
            SELECT *
            FROM session_ids
            WHERE id = ${sessionId}
        `;

        const sessionRow = sessionRows[0];

        if (!sessionRow) {
            this.cache.setCached(`session.${sessionId}`, null, 5);
            return undefined;
        }
        
        this.cache.setCached(`session.${sessionId}`, sessionRow, 30);
        return sessionRow as SessionId;
    }

    async getSessionByIpAndAgent(user: string|Account, ipAddress: string, userAgent: string): Promise<SessionId|undefined> {
        const userId = typeof user === "string" ? user : user.user_id;
        const cachedSession = this.cache.getCached<SessionId>(`session.${userId}.${ipAddress}.${userAgent}`);
        if (cachedSession)
            return cachedSession === null ? undefined : cachedSession;

        const sessionRows = await this.postgresConnection`
            SELECT *
            FROM session_ids
            WHERE discord_user_id = ${userId} AND ip_address = ${ipAddress} AND user_agent=${userAgent}
        `;

        const sessionRow = sessionRows[0];

        if (!sessionRow) {
            this.cache.setCached(`session.${userId}.${ipAddress}`, null, 5);
            return undefined;
        }
        
        this.cache.setCached(`session.${userId}.${ipAddress}`, sessionRow, 10);
        return sessionRow as SessionId;
    }

    async getOrCreateSession(user: string|Account, ipAddress: string, userAgent: string): Promise<SessionId> {
        const userId = typeof user === "string" ? user : user.user_id;
        const existingSession = await this.getSessionByIpAndAgent(userId, ipAddress, userAgent);

        if (existingSession)
            return existingSession;

        const newSessionId = await this.generateRandomHash();

        await this.postgresConnection`
            INSERT INTO session_ids(discord_user_id, id, ip_address, user_agent)
            VALUES (${userId}, ${newSessionId}, ${ipAddress}, ${userAgent})
        `;

        return {
            discord_user_id: userId,
            id: newSessionId,
            ip_address: ipAddress
        } as SessionId;
    }

    async destroySession(sessionId: string) {
        await this.postgresConnection`
            DELETE
            FROM session_ids
            WHERE id = ${sessionId}
        `;

        await this.cache.invalidateCached(`session.${sessionId}`);
    }

    async getAccount(userId: string): Promise<Account|undefined> {
        const cachedAccount = this.cache.getCached<Account>(`account.${userId}`);
        if (cachedAccount)
            return cachedAccount === null ? undefined : cachedAccount;

        const accountRows = await this.postgresConnection`
            SELECT *
            FROM accounts
            WHERE user_id = ${userId}
        `;

        const accountRow = accountRows[0];

        if (!accountRow) {
            this.cache.setCached(`account.${userId}`, null, 5);
            return undefined;
        }
        
        this.cache.setCached(`account.${userId}`, accountRow, 30);
        return accountRow as Account;
    }

    async createAccount(userId: string, accessToken: string, refreshToken: string, tokenType: string, expiresAt: Date, scope: string) {
        await this.postgresConnection`
            INSERT INTO accounts (access_token, refresh_token, token_type, expires_at, scope, user_id)
            VALUES (${accessToken}, ${refreshToken}, ${tokenType}, ${expiresAt.toISOString()}, ${scope}, ${userId})
            ON CONFLICT ON CONSTRAINT discord_users_pk
            DO UPDATE
                SET access_token = ${accessToken}, refresh_token = ${refreshToken}, token_type = ${tokenType}, expires_at = ${expiresAt.toISOString()}, scope = ${scope}
        `;

        await this.cache.invalidateCached(`account.${userId}`);
    }

    async getDiscordAccessToken(user: string|Account): Promise<string|undefined> {
        const account = typeof user === "string"
            ? await this.getAccount(user)
            : user;

        if (!account)
            return undefined;

        const date = Date.now();
        const expiresAt = new Date(account.expires_at);
        if (date > expiresAt.getTime()) {
            const tokenRefreshJson: dtypes.RESTPostOAuth2RefreshTokenResult = await got.post("https://discord.com/api/v9" + dtypes.Routes.oauth2TokenExchange(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: `client_id=${process.env.CLIENT_ID as string}&client_secret=${process.env.CLIENT_SECRET as string}&grant_type=refresh_token&refresh_token=${account.refresh_token}`
            }).json();

            const newExpiresAt = new Date(date + tokenRefreshJson.expires_in);

            await this.postgresConnection`
                UPDATE accounts
                SET access_token = ${tokenRefreshJson.access_token}, refresh_token = ${tokenRefreshJson.refresh_token}, expires_at = ${newExpiresAt.toISOString()}, token_type = ${tokenRefreshJson.token_type}, scope = ${tokenRefreshJson.scope}
                WHERE user_id = ${account.user_id}
            `;

            await this.cache.invalidateCached(`account.${account.user_id}`);

            return tokenRefreshJson.access_token;
        }

        return account.access_token;
    }

    async revokeDiscordAccess(user: string|Account) {
        const account = typeof user === "string"
            ? await this.getAccount(user)
            : user;

        if (!account)
            return undefined;
            
        await got.post("https://discord.com/api/v9" + dtypes.Routes.oauth2TokenRevocation(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${process.env.CLIENT_ID as string}&client_secret=${process.env.CLIENT_SECRET as string}&token=${account.access_token}&token_type_hint=access_token`
        });
        
        try {
            await got.post("https://discord.com/api/v9" + dtypes.Routes.oauth2TokenRevocation(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: `client_id=${process.env.CLIENT_ID as string}&client_secret=${process.env.CLIENT_SECRET as string}&token=${account.refresh_token}&token_type_hint=refresh_token`
            });
        } catch (e) {}

        await this.postgresConnection`
            UPDATE accounts
            SET access_token = NULL, refresh_token = NULL, expires_at = NULL, token_type = NULL, scope = NULL
            WHERE user_id = ${account.user_id}
        `;
        
        await this.cache.invalidateCached(`account.${account.user_id}`);
    }

    async getDiscordUser(userId: string): Promise<dtypes.APIUser|undefined> {
        const accessToken = await this.getDiscordAccessToken(userId);

        if (!accessToken)
            return undefined;

        const rest = await new REST().setToken(accessToken).get(dtypes.Routes.user("@me"), {
            authPrefix: "Bearer"
        }) as dtypes.APIUser;

        return rest;
    }

    async getAccountConnections(user: string|Account): Promise<AccountConnection[]> {
        const userId = typeof user === "string" ? user : user.user_id;

        const cachedConnections = this.cache.getCached<AccountConnection[]>(`connections.${userId}`);
        if (cachedConnections)
            return cachedConnections;

        const accountConnections = await this.postgresConnection`
            SELECT *
            FROM account_connections
            WHERE discord_user_id = ${userId}
        `;

        this.cache.setCached(`connections.${userId}`, accountConnections, 30);
        return Array.from(accountConnections) as AccountConnection[];
    }

    async getAccountConnection(user: string|Account, connectionName: string): Promise<AccountConnection|undefined> {
        const userId = typeof user === "string" ? user : user.user_id;

        const cachedConnection = this.cache.getCached<AccountConnection>(`connection.${userId}.${connectionName}`);
        if (cachedConnection)
            return cachedConnection === null ? undefined : cachedConnection;

        const accountConnections = await this.postgresConnection`
            SELECT *
            FROM account_connections
            WHERE discord_user_id = ${userId} AND connection_name = ${connectionName}
        `;

        const accountConnection = accountConnections[0];
        if (!accountConnection) {
            this.cache.setCached(`connection.${userId}.${connectionName}`, null, 5);
            return undefined;
        }

        this.cache.setCached(`connection.${userId}.${connectionName}`, accountConnection, 30);
        return accountConnection as AccountConnection;
    }

    async createAccountConnection(user: string|Account, connectionName: string, connectionUserId: string, accessToken: string, refreshToken?: string) {
        const userId = typeof user === "string" ? user : user.user_id;

        await this.postgresConnection`
            INSERT INTO account_connections(discord_user_id, user_id, access_token, refresh_token, connection_name)
            VALUES (${userId}, ${connectionUserId}, ${accessToken}, ${refreshToken ?? "NULL"}, ${connectionName})
        `;

        await this.cache.invalidateCached(`connections.${userId}`);
        await this.cache.invalidateCached(`connection.${userId}.${connectionName}`);
    }

    async unlinkAccountConnection(user: string|Account, connectionName: string) {
        const userId = typeof user === "string" ? user : user.user_id;

        await this.postgresConnection`
            DELETE
            FROM account_connections
            WHERE discord_user_id = ${userId} AND connection_name = ${connectionName}
        `;

        await this.cache.invalidateCached(`connections.${userId}`);
        await this.cache.invalidateCached(`connection.${userId}.${connectionName}`);
    }

    async getAccessToken(accountConnection: AccountConnection) {
        if (accountConnection.refresh_token === "NULL") {
            return accountConnection.access_token;
        }

        // check against each connection name/type

        return accountConnection.access_token;
    }

    async getInteractionState(executionId: string) {
        const cachedState = this.cache.getCached<InteractionState>(`interaction.${executionId}`);
        if (cachedState) {
            return cachedState === null ? undefined : cachedState;
        }

        const interactionStateRows = await this.postgresConnection`
            SELECT *
            FROM interaction_states
            WHERE execution_id = ${executionId}
        `;

        const interactionState = interactionStateRows[0];

        if (!interactionState) {
            await this.cache.setCached(`interaction.${executionId}`, null, 5);
            return undefined;
        }

        await this.cache.setCached(`interaction.${executionId}`, interactionState, 10);
        return interactionState as InteractionState;
    }

    async createInteractionState(executionId: string, userId: string, guildId: string, commandName: string, commandVersion: string, state: any) {
        const strState = JSON.stringify(state);

        await this.postgresConnection`
            INSERT INTO interaction_states(user_id, guild_id, interaction_state, execution_id, command_name, command_version)
            VALUES (${userId}, ${guildId}, ${strState}, ${executionId}, ${commandName}, ${commandVersion})
            ON CONFLICT ON CONSTRAINT interaction_states_pkey
            DO UPDATE
                SET interaction_state = ${strState}
        `;
        
        await this.cache.invalidateCached(`interaction.${executionId}`);
    }

    async setInteractionState(executionId: string, state: any) {
        const strState = JSON.stringify(state);

        const updatedRows = await this.postgresConnection`
            UPDATE interaction_states
            SET interaction_state = ${strState}
            WHERE execution_id = ${executionId}
            RETURNING *
        `;

        const updatedRow = updatedRows[0] as InteractionState;

        if (!updatedRow)
            return;
        
        await this.cache.invalidateCached(`interaction.${executionId}`);
        await this.cache.setCached(`interaction.${executionId}`, updatedRow, 10);
    }

    async deleteAllInformation(user: string|Account) {
        const userId = typeof user === "string" ? user : user.user_id;
        
        const interactions = await this.postgresConnection`
            DELETE
            FROM interaction_states
            WHERE user_id = ${userId}
            RETURNING *
        ` as InteractionState[];

        await this.postgresConnection`
            DELETE
            FROM accounts
            WHERE user_id = ${userId}
        `;
        
        const connections = await this.postgresConnection`
            DELETE
            FROM account_connections
            WHERE discord_user_id = ${userId}
            RETURNING *
        ` as AccountConnection[];
        
        const sessions = await this.postgresConnection`
            DELETE
            FROM session_ids
            WHERE discord_user_id = ${userId}
            RETURNING *
        ` as SessionId[];

        await this.cache.invalidateCached(`connections.${userId}`);
        await this.cache.invalidateCached(`account.${userId}`);
        await this.cache.invalidateCached(`sessions.${userId}`);

        for (const interaction of interactions) {
            await this.cache.invalidateCached(`interaction.${interaction.execution_id}`);
        }

        for (const connection of connections) {
            await this.cache.invalidateCached(`connection.${userId}.${connection.connection_name}`);
        }
        
        for (const session of sessions) {
            await this.cache.invalidateCached(`session.${session.id}`);
            await this.cache.invalidateCached(`session.${session.discord_user_id}.${session.ip_address}`);
        }
    }
}