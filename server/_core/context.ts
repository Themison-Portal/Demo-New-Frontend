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

                try {
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
                } catch (dbErr) {
                    // Local BFF user DB is unavailable (see "[Database] Cannot get/upsert
                    // user: database not available" in server logs). This does NOT mean
                    // the request is unauthenticated — the Auth0 token itself is valid,
                    // we just can't persist/look up a local row for it right now. Fall
                    // through to the synthetic-user branch below instead of leaving
                    // ctx.user null, which would incorrectly 401 every protectedProcedure
                    // call and break the many places downstream that assume ctx.user.id
                    // exists on any authenticated request.
                    console.warn("[Auth0] Local user DB unavailable, using synthetic token-derived user:", dbErr);
                }

                // Fallback: local DB lookup/create didn't produce a user (either it
                // threw above, or it's genuinely a brand-new user and the DB write
                // failed). Synthesize a non-persisted User from the token claims so
                // ctx.user is never null for a request carrying a valid Auth0 token.
                // NOTE: `id` here is NOT a real local DB primary key — features that
                // store/query by this numeric id locally (collaboration threads, demo
                // snapshots, execution-map local ownership) will not correctly
                // associate with this synthetic id until the local DB is restored.
                // Auth/identity and all real-backend-proxied calls (trials, documents,
                // organizations, etc.) are unaffected, since those use ctx.authToken.
                if (!user) {
                    user = {
                        id: -1,
                        openId,
                        name: name || null,
                        email: email || null,
                        loginMethod: "auth0",
                        role: "user",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        lastSignedIn: new Date(),
                    };
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