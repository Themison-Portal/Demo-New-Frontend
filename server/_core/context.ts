import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * Auth0 access token forwarded by the React client. Procedures that
   * proxy to core-backend's JWT-protected endpoints pass this through
   * verbatim. `null` when the user isn't logged in via Auth0 (or when
   * the request didn't include an Authorization header at all). The
   * server does NOT validate the token — core-backend validates against
   * its configured AUTH0_DOMAIN/AUTH0_AUDIENCE.
   */
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

/**
 * Pull a Bearer token off `Authorization: Bearer <jwt>`. Returns null
 * for any non-bearer header (cookies, basic auth, missing) so the
 * existing OAuth-portal cookie flow is undisturbed.
 */
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

  if (!ENV.oAuthServerUrl) {
    return {
      req: opts.req,
      res: opts.res,
      user: DEV_USER,
      authToken,
    };
  }

  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authToken,
  };
}
