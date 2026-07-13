import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useDemoState } from "@/contexts/DemoStateContext";

type MemberFormValues = {
  name: string;
  email: string;
  avatar?: string | null;
  clinicalRole: string;
  appRole: string;
  team: string;
  site: string;
};

type AddMemberPanelProps = {
  open: boolean;
  onClose: () => void;
  editingMemberId?: string | null;
  initialValues: MemberFormValues;
  onMemberSaved?: (memberId: string, values: MemberFormValues, isNew: boolean) => void;
};

export function AddMemberPanel({
  open,
  onClose,
  editingMemberId,
  initialValues,
  onMemberSaved,
}: AddMemberPanelProps) {
  const { addTeamMember, updateTeamMember } = useDemoState();
  const [formValues, setFormValues] = useState<MemberFormValues>(initialValues);

  useEffect(() => {
    if (open) {
      setFormValues(initialValues);
    }
  }, [open, initialValues]);

  const handleSaveMember = () => {
    if (!formValues.name.trim() || !formValues.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    const savedValues: MemberFormValues = {
      ...formValues,
      name: formValues.name.trim(),
      email: formValues.email.trim(),
      team: formValues.team.trim(),
      site: formValues.site.trim(),
    };
    if (editingMemberId) {
      updateTeamMember(editingMemberId, {
        name: savedValues.name,
        email: savedValues.email,
        clinicalRole: formValues.clinicalRole,
        role: formValues.clinicalRole,
        appRole: formValues.appRole,
        team: savedValues.team,
        site: savedValues.site,
      });
      if (onMemberSaved) {
        onMemberSaved(editingMemberId, savedValues, false);
      }
    } else {
      const newMemberId = `member-${Date.now()}`;
      const initials = formValues.name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
      addTeamMember({
        id: newMemberId,
        name: formValues.name.trim(),
        email: formValues.email.trim(),
        role: formValues.clinicalRole,
        clinicalRole: formValues.clinicalRole,
        appRole: formValues.appRole,
        team: formValues.team.trim(),
        site: formValues.site.trim(),
        status: "Active",
        initials: initials || "TM",
      });
      if (onMemberSaved) {
        onMemberSaved(newMemberId, savedValues, true);
      }
    }
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`absolute right-0 top-0 h-full bg-white border-l border-gray-200 flex flex-col transform-gpu transition-[transform,opacity] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
          open ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
        }`}
        style={{ width: "520px", maxWidth: "60vw" }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {editingMemberId ? "Edit Member" : "Add Member"}
            </h2>
            <p className="text-xs text-gray-500">
              {editingMemberId ? "Update team details and roles." : "Add a teammate to your organization."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</label>
            <Input
              className="mt-2"
              placeholder="Full name"
              value={formValues.name}
              onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</label>
            <Input
              className="mt-2"
              placeholder="name@company.com"
              value={formValues.email}
              onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clinical Role</label>
              <select
                className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
                value={formValues.clinicalRole}
                onChange={(event) => setFormValues((prev) => ({ ...prev, clinicalRole: event.target.value }))}
              >
                <option>Principal Investigator</option>
                <option>Sub-Investigator</option>
                <option>CRC</option>
                <option>CRA</option>
                <option>Lead CRA</option>
                <option>Clinical Trial Manager (CTM)</option>
                <option>Site Management Associate (SMA)</option>
                <option>Clinical Project Manager</option>
                <option>Nurse</option>
                <option>Lab</option>
                <option>Data Manager</option>
                <option>Regulatory</option>
                <option>Quality</option>
                <option>Safety</option>
                <option>Project Manager</option>
                <option>Medical Monitor</option>
                <option>Sponsor</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">App Role</label>
              <select
                className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
                value={formValues.appRole}
                onChange={(event) => setFormValues((prev) => ({ ...prev, appRole: event.target.value }))}
              >
                <option>Admin</option>
                <option>Editor</option>
                <option>Viewer</option>
                <option>Superadmin</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Team</label>
              <Input
                className="mt-2"
                placeholder="Team name"
                value={formValues.team}
                onChange={(event) => setFormValues((prev) => ({ ...prev, team: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Site</label>
              <Input
                className="mt-2"
                placeholder="Site location"
                value={formValues.site}
                onChange={(event) => setFormValues((prev) => ({ ...prev, site: event.target.value }))}
              />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleSaveMember}
            disabled={!formValues.name.trim() || !formValues.email.trim()}
          >
            {editingMemberId ? "Save Changes" : "Add Member"}
          </button>
        </div>
      </div>
    </div>
  );
}
