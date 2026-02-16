type TrialSeed = {
  id: string;
  location?: string | null;
};

type TeamMemberSeed = {
  id: string | number;
  name?: string | null;
  role?: string | null;
  clinicalRole?: string | null;
  location?: string | null;
};

interface EnsureTrialTeamAssignmentsInput {
  mode: "sample" | "full" | "building";
  trials: TrialSeed[];
  members: TeamMemberSeed[];
}

function includesAny(value: string, tokens: string[]) {
  const normalized = value.toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

function memberRoleText(member: TeamMemberSeed) {
  return `${member.role || ""} ${member.clinicalRole || ""}`.toLowerCase();
}

function pickByLocation(candidates: TeamMemberSeed[], location?: string | null) {
  if (!location) return candidates;
  const normalized = location.trim().toLowerCase();
  const local = candidates.filter((member) =>
    String(member.location || "")
      .trim()
      .toLowerCase()
      .includes(normalized)
  );
  return local.length > 0 ? local : candidates;
}

export function ensureTrialTeamAssignments({
  mode,
  trials,
  members,
}: EnsureTrialTeamAssignmentsInput): void {
  if (typeof window === "undefined") return;
  if (!Array.isArray(trials) || !Array.isArray(members)) return;

  const validMembers = members
    .map((member) => ({
      ...member,
      id: String(member.id || "").trim(),
    }))
    .filter((member) => member.id);

  if (validMembers.length === 0) return;

  for (const trial of trials) {
    const trialId = String(trial.id || "").trim().toLowerCase();
    if (!trialId) continue;

    const key = `trial-team:${mode}:${trialId}`;
    const existing = window.localStorage.getItem(key);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (Array.isArray(parsed) && parsed.length > 0) continue;
      } catch {
        // fall through and reseed malformed payload
      }
    }

    const locationScoped = pickByLocation(validMembers, trial.location);
    const piCandidates = locationScoped.filter((member) =>
      includesAny(memberRoleText(member), ["principal investigator", " pi", "pi ", "sub-investigator"])
    );
    const crcCandidates = locationScoped.filter((member) =>
      includesAny(memberRoleText(member), ["crc", "coordinator", "clinical research coordinator"])
    );

    const picked: string[] = [];
    const add = (member?: TeamMemberSeed) => {
      const id = String(member?.id || "");
      if (!id || picked.includes(id)) return;
      picked.push(id);
    };

    add(piCandidates[0]);
    add(crcCandidates[0]);

    for (const member of locationScoped) {
      if (picked.length >= 5) break;
      add(member);
    }
    for (const member of validMembers) {
      if (picked.length >= 5) break;
      add(member);
    }

    if (picked.length > 0) {
      window.localStorage.setItem(key, JSON.stringify(picked));
      window.dispatchEvent(new CustomEvent("trial-team-updated"));
    }
  }
}
