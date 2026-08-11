import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { decodeJwt } from "jose";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
    req: CreateExpressContextOptions["req"];
    res: CreateExpressContextOptions["res"];
    user: User | null;
    authToken: string | null;
};

const DEV_USER: User = {
    id: 1,
    openId: "dev-user",
    name: "Demo User",
    email: null,
    loginMethod: "dev",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
};

function extractBearerToken(req: CreateExpressContextOptions["req"]): string | null {
    const header = req.headers.authorization ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) return null;
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
}

export async function createContext(
    opts: CreateExpressContextOptions
): Promise<TrpcContext> {
    const authToken = extractBearerToken(opts.req);

    if (!ENV.oAuthServerUrl && !authToken) {
        return {
            req: opts.req,
            res: opts.res,
            user: DEV_USER,
            authToken,
        };
    }

    let user: User | null = null;

    if (ENV.oAuthServerUrl) {
        try {
            user = await sdk.authenticateRequest(opts.req);
        } catch (error) {
            user = null;
        }
    }

    if (!user && authToken) {
        try {
            const decoded = decodeJwt(authToken);
            const openId = decoded.sub;
            if (openId) {
                const email = (decoded.email || decoded["https://themison.com/email"]) as string | undefined;
                const name = (decoded.name || decoded.nickname) as string | undefined;

                const dbUser = await getUserByOpenId(openId);
                if (dbUser) {
                    user = dbUser;
                } else {
                    const signedInAt = new Date();
                    await upsertUser({
                        openId,
                        name: name || null,
                        email: email || null,
                        loginMethod: "auth0",
                        lastSignedIn: signedInAt,
                    });
                    user = (await getUserByOpenId(openId)) ?? null;
                }
            }
        } catch (err) {
            console.warn("[Auth0] Failed to decode user from authToken:", err);
        }
    }

    return {
        req: opts.req,
        res: opts.res,
        user,
        authToken,
    };
}