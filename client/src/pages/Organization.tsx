/**
 * Organization Page
 * Design: Clinical Modernism
 */

import { useState } from "react";
import { Building2, LayoutGrid, Users, Settings, Plus, Send } from "lucide-react";
import { logEvent } from "@/lib/telemetry";
import { useDemoState } from "@/contexts/DemoStateContext";
import { AddMemberPanel } from "@/components/AddMemberPanel";

export default function Organization() {
  const [activeTab, setActiveTab] = useState<"overview" | "members" | "settings">("overview");

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "members", label: "Members", icon: Users },
    { id: "settings", label: "Settings", icon: Settings },
  ] as const;

  const { state } = useDemoState();
  const members = state.teamMembers.map((member) => ({
    id: member.id,
    name: member.name,
    clinicalRole: member.clinicalRole || member.role,
    email: member.email,
    appRole: member.appRole || "Editor",
    status: member.status || "Active",
    team: member.team || "Operations",
    site: member.site || "Remote",
  }));
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const [formValues, setFormValues] = useState({
    name: "",
    email: "",
    clinicalRole: "Principal Investigator",
    appRole: "Admin",
    team: "",
    site: "",
  });

  const openAddMember = () => {
    setEditingMemberId(null);
    setFormValues({
      name: "",
      email: "",
      clinicalRole: "Principal Investigator",
      appRole: "Admin",
      team: "",
      site: "",
    });
    setEditPanelOpen(true);
  };

  const openEditMember = (member: typeof members[number]) => {
    setEditingMemberId(member.id);
    setFormValues({
      name: member.name,
      email: member.email,
      clinicalRole: member.clinicalRole,
      appRole: member.appRole,
      team: member.team,
      site: member.site,
    });
    setEditPanelOpen(true);
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Tabs Navigation Bar */}
      <div className="bg-[#F9FAFB] px-8 pt-3 pb-1 sticky top-0 z-40">
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-2 flex items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  logEvent({
                    eventType: "feature_used",
                    action: "switch_tab",
                    entityType: "organization_tab",
                    entityId: tab.id,
                  });
                }}
                className={`flex items-center gap-2 px-3 py-1 text-xs transition-colors rounded ${
                  activeTab === tab.id
                    ? "text-blue-600 bg-[#F3F4F6]"
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-8 pt-6 pb-8">
        {activeTab === "overview" && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-baseline gap-3">
                <h1 className="text-2xl font-semibold text-gray-900">Organization</h1>
                <p className="text-sm text-gray-500">Overview</p>
              </div>
            </div>
            <div className="px-6 py-10 text-sm text-gray-500">
              Organization overview coming soon.
            </div>
          </div>
        )}

        {activeTab === "members" && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl font-semibold text-gray-900">Members</h2>
                <p className="text-sm text-gray-500">{members.length} members</p>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                onClick={openAddMember}
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1060px]">
                <div className="border-b border-gray-200 bg-gray-50 w-full">
                  <div className="grid grid-cols-[1.6fr_2fr_1.2fr_1fr_1fr_1fr_90px_52px] gap-4 px-6 py-3">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Name
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Email
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Clinical Role
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    App Role
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Team
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Site
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider text-right whitespace-nowrap">
                    Invite
                  </div>
                  </div>
                </div>
                <div>
                  {members.map((member) => (
                    <div
                      key={member.email}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors w-full cursor-pointer"
                      onClick={() => openEditMember(member)}
                    >
                      <div className="grid grid-cols-[1.6fr_2fr_1.2fr_1fr_1fr_1fr_90px_52px] gap-4 px-6 py-4 text-sm text-gray-700">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center">
                          <Users className="h-4 w-4 text-gray-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{member.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center text-gray-600 min-w-0">
                    <span className="truncate" title={member.email}>{member.email}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
                      {member.clinicalRole}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                      {member.appRole}
                    </span>
                  </div>
                  <div className="flex items-center text-gray-600 text-xs whitespace-nowrap">
                    {member.team}
                  </div>
                  <div className="flex items-center text-gray-600 text-xs whitespace-nowrap">
                    {member.site}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    {member.status}
                  </div>
                      <div className="flex items-center justify-end">
                        <button
                          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="bg-white rounded-lg border border-gray-200 px-6 py-10 text-sm text-gray-500">
            Settings view coming soon.
          </div>
        )}
      </div>

      <AddMemberPanel
        open={editPanelOpen}
        onClose={() => setEditPanelOpen(false)}
        editingMemberId={editingMemberId}
        initialValues={formValues}
      />
    </div>
  );
}
