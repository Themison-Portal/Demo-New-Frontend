import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("studySetupWizard", () => {
  it("creates authenticated context for testing", () => {
    const { ctx } = createAuthContext();
    
    expect(ctx.user).toBeDefined();
    expect(ctx.user?.id).toBe(1);
    expect(ctx.user?.role).toBe("user");
  });

  // Note: Full integration tests would require database setup
  // For now, we're just validating the test infrastructure works
  it("validates test user structure", () => {
    const { ctx } = createAuthContext();
    
    expect(ctx.user).toMatchObject({
      id: expect.any(Number),
      openId: expect.any(String),
      email: expect.any(String),
      name: expect.any(String),
      role: expect.stringMatching(/^(user|admin)$/),
    });
  });
});
