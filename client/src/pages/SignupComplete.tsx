/**
 * Public signup / invitation-acceptance page (`/signup?token=…`).
 *
 * This is where the link in an invitation email lands. The BE creates the
 * Auth0 user from the password set here, so this page is required to close
 * the invitation loop:
 *   1. Read `?token=` and validate it against the BE (org + invited email).
 *   2. Collect a password (+ optional name).
 *   3. Call `/auth/signup/complete`, which creates the Auth0 user + profile +
 *      member and marks the invitation accepted.
 *   4. Hand off to Auth0 hosted login so the invitee signs in with the new
 *      credentials.
 *
 * Rendered outside the DashboardLayout chrome (see App.tsx), like /callback.
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  invitationsApi,
  type ValidatedInvitation,
} from "@/lib/invitationsApi";
import { triggerAuth0Login } from "@/auth/auth0Provider";

type Status = "validating" | "invalid" | "ready" | "submitting" | "done";

function splitName(name: string | null): { first: string; last: string } {
  if (!name) return { first: "", last: "" };
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

const PASSWORD_HINT =
  "At least 8 characters, using 3 of: lowercase, uppercase, number, symbol.";

/**
 * Client-side check mirroring Auth0's default "Good" database password policy
 * (≥8 chars and ≥3 of the 4 character classes). Auth0 remains the source of
 * truth — if the tenant policy differs, the backend now surfaces Auth0's exact
 * message — but this catches the common case before a round-trip. Returns an
 * error string, or null when the password passes.
 */
function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(pw)
  ).length;
  if (classes < 3) {
    return "Password is too weak — " + PASSWORD_HINT.toLowerCase();
  }
  return null;
}

export default function SignupComplete() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [status, setStatus] = useState<Status>("validating");
  const [invitation, setInvitation] = useState<ValidatedInvitation | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus("invalid");
      setErrorMsg("This signup link is missing its invitation token.");
      return;
    }
    (async () => {
      try {
        const inv = await invitationsApi.validateInvitation(token);
        if (cancelled) return;
        setInvitation(inv);
        const { first, last } = splitName(inv.name);
        setFirstName(first);
        setLastName(last);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "This invitation is invalid or has expired."
        );
        setStatus("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const issue = passwordIssue(password);
    if (issue) {
      toast.error(issue);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setStatus("submitting");
    try {
      await invitationsApi.completeSignup({
        token,
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      setStatus("done");
      toast.success("Account created — signing you in…");
      // Give the toast a beat, then send them to Auth0 hosted login to sign
      // in with the credentials they just set.
      setTimeout(() => {
        void loginAsInvitee();
      }, 1500);
    } catch (err) {
      setStatus("ready");
      toast.error(
        err instanceof Error ? err.message : "Could not complete signup."
      );
    }
  };

  // After signup, force a FRESH Auth0 login as the invited user. Without
  // prompt:"login" Auth0 silently reuses any existing SSO session in the
  // browser — so a signed-in teammate would get logged in as themselves
  // instead of the new account. login_hint pre-fills the invitee's email.
  const loginAsInvitee = () =>
    triggerAuth0Login({
      authorizationParams: {
        prompt: "login",
        login_hint: invitation?.email,
      },
    });

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        {status === "validating" && (
          <div className="flex flex-col items-center gap-3 py-8 text-gray-500">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="text-sm">Validating your invitation…</p>
          </div>
        )}

        {status === "invalid" && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">Invitation unavailable</h1>
            <p className="mt-2 text-sm text-gray-500">{errorMsg}</p>
            <button
              className="mt-6 inline-flex items-center justify-center rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => void triggerAuth0Login()}
            >
              Go to sign in
            </button>
          </div>
        )}

        {status === "done" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <h1 className="text-lg font-semibold text-gray-900">Account created</h1>
            <p className="text-sm text-gray-500">Redirecting you to sign in…</p>
            <button
              className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
              onClick={() => void loginAsInvitee()}
            >
              Continue to sign in
            </button>
          </div>
        )}

        {(status === "ready" || status === "submitting") && invitation && (
          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-gray-900">
                Join {invitation.organization.name}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                You were invited as <span className="font-medium">{invitation.email}</span>.
                Set a password to create your account.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    First name
                  </label>
                  <Input
                    className="mt-2"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Last name
                  </label>
                  <Input
                    className="mt-2"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Email
                </label>
                <Input className="mt-2 bg-gray-50" value={invitation.email} disabled readOnly />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Password
                </label>
                <Input
                  className="mt-2"
                  type="password"
                  placeholder="Choose a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-gray-400">{PASSWORD_HINT}</p>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Confirm password
                </label>
                <Input
                  className="mt-2"
                  type="password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {status === "submitting" ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
