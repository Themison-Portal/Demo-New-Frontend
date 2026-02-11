/**
 * Organization Page
 * Design: Clinical Modernism
 */

import { useEffect, useRef, useState } from "react";
import { Building2, LayoutGrid, Users, Settings, Plus, Send, Upload, Save, Globe, Mail, MapPin, Trash2, Home, Brain, Phone } from "lucide-react";
import { logEvent } from "@/lib/telemetry";
import { useDemoState } from "@/contexts/DemoStateContext";
import { AddMemberPanel } from "@/components/AddMemberPanel";
import { toast } from "sonner";
import { useOrganizationProfile } from "@/hooks/useOrganizationProfile";
import { trpc } from "@/lib/trpc";

export default function Organization() {
  const [activeTab, setActiveTab] = useState<"overview" | "members" | "settings">("overview");
  const { profile, replaceProfile, organizationInitial } = useOrganizationProfile();
  const suggestFromWebsiteMutation = trpc.organization.suggestFromWebsite.useMutation();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [overviewForm, setOverviewForm] = useState({
    name: profile.name,
    legalName: profile.legalName,
    location: profile.location,
    address: profile.address,
    website: profile.website,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    description: profile.description,
    logoDataUrl: profile.logoDataUrl as string | null,
  });

  useEffect(() => {
    setOverviewForm({
      name: profile.name,
      legalName: profile.legalName,
      location: profile.location,
      address: profile.address,
      website: profile.website,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      description: profile.description,
      logoDataUrl: profile.logoDataUrl,
    });
  }, [profile]);
  const previewInitial = String(overviewForm.name || organizationInitial).trim().charAt(0).toUpperCase() || "O";

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

  const handleOverviewChange = (field: keyof typeof overviewForm, value: string | null) => {
    setOverviewForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveOverview = () => {
    const cleanedName = overviewForm.name.trim();
    if (!cleanedName) {
      toast.error("Organization name is required.");
      return;
    }
    replaceProfile({
      name: cleanedName,
      legalName: overviewForm.legalName.trim(),
      location: overviewForm.location.trim(),
      address: overviewForm.address.trim(),
      website: overviewForm.website.trim(),
      contactEmail: overviewForm.contactEmail.trim(),
      contactPhone: overviewForm.contactPhone.trim(),
      description: overviewForm.description.trim(),
      logoDataUrl: overviewForm.logoDataUrl,
    });
    toast.success("Organization profile saved");
    logEvent({
      eventType: "feature_used",
      action: "save_organization_profile",
      entityType: "organization",
      entityId: cleanedName,
    });
  };

  const handleLogoSelected = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setOverviewForm((prev) => ({
        ...prev,
        logoDataUrl: result,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleAutofillWithThemison = async () => {
    if (!overviewForm.website.trim()) {
      toast.error("Add a website first so Themison can pull public organization details.");
      return;
    }
    try {
      const suggestion = await suggestFromWebsiteMutation.mutateAsync({
        website: overviewForm.website.trim(),
      });
      setOverviewForm((prev) => {
        const next = { ...prev };
        const name = String(suggestion.name || "").trim();
        const legalName = String(suggestion.legalName || "").trim();
        const location = String(suggestion.location || "").trim();
        const address = String(suggestion.address || "").trim();
        const website = String(suggestion.website || "").trim();
        const contactEmail = String(suggestion.contactEmail || "").trim();
        const contactPhone = String((suggestion as any).contactPhone || "").trim();
        const description = String(suggestion.description || "").trim();

        if (name) next.name = name;
        if (legalName) next.legalName = legalName;
        next.location = location;
        next.address = address;
        if (website) next.website = website;
        next.contactEmail = contactEmail || next.contactEmail;
        if (contactPhone) next.contactPhone = contactPhone;
        if (description) next.description = description;
        if (suggestion.logoDataUrl) next.logoDataUrl = suggestion.logoDataUrl;
        return next;
      });
      if (!suggestion.location && !suggestion.address) {
        toast.info("Themison could not find a clear address on this site. Add or edit it manually if needed.");
      } else {
        toast.success("Themison pulled website data. Review and click Save Profile.");
      }
    } catch (error: any) {
      const message = String(error?.message || "Could not pull organization details from the web.");
      toast.error(message);
    }
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleAutofillWithThemison()}
                  disabled={suggestFromWebsiteMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                >
                  <Brain className="h-4 w-4" />
                  {suggestFromWebsiteMutation.isPending ? "Themison is pulling..." : "Themison Auto-fill"}
                </button>
                <button
                  onClick={handleSaveOverview}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Save className="h-4 w-4" />
                  Save Profile
                </button>
              </div>
            </div>
            <div className="px-6 py-6">
              <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
                <div className="rounded-lg border border-gray-200 p-5 space-y-5">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Logo</p>
                    <p className="text-xs text-gray-500 mt-1">Used in workspace navigation and branding.</p>
                  </div>
                  <div className="space-y-3">
                    <div className="h-[148px] w-full rounded-lg bg-white border border-gray-200 overflow-hidden flex items-center justify-center p-3">
                      {overviewForm.logoDataUrl ? (
                        <img
                          src={overviewForm.logoDataUrl}
                          alt="Organization logo"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-3xl font-semibold text-primary">{previewInitial}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Large preview for upload validation. Compact icon preview uses the organization initial.
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload Logo
                    </button>
                    {overviewForm.logoDataUrl ? (
                      <button
                        type="button"
                        onClick={() => handleOverviewChange("logoDataUrl", null)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      handleLogoSelected(event.target.files?.[0] || null);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-xs text-gray-600">
                      Display name: <span className="font-medium text-gray-900">{overviewForm.name || "—"}</span>
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Location: <span className="font-medium text-gray-900">{overviewForm.location || "—"}</span>
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Address: <span className="font-medium text-gray-900">{overviewForm.address || "—"}</span>
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      Phone: <span className="font-medium text-gray-900">{overviewForm.contactPhone || "—"}</span>
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Organization Name</span>
                      <input
                        value={overviewForm.name}
                        onChange={(event) => handleOverviewChange("name", event.target.value)}
                        placeholder="Themison Research"
                        className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Legal Entity</span>
                      <input
                        value={overviewForm.legalName}
                        onChange={(event) => handleOverviewChange("legalName", event.target.value)}
                        placeholder="Themison Research, Inc."
                        className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Location</span>
                      <div className="relative mt-1">
                        <MapPin className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={overviewForm.location}
                          onChange={(event) => handleOverviewChange("location", event.target.value)}
                          placeholder="City, Country"
                          className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-400"
                        />
                      </div>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contact Email</span>
                      <div className="relative mt-1">
                        <Mail className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={overviewForm.contactEmail}
                          onChange={(event) => handleOverviewChange("contactEmail", event.target.value)}
                          placeholder="ops@company.com"
                          className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-400"
                        />
                      </div>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Phone Number</span>
                      <div className="relative mt-1">
                        <Phone className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={overviewForm.contactPhone}
                          onChange={(event) => handleOverviewChange("contactPhone", event.target.value)}
                          placeholder="+45 70 12 34 56"
                          className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-400"
                        />
                      </div>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Address</span>
                      <div className="relative mt-1">
                        <Home className="h-4 w-4 text-gray-400 absolute left-3 top-3.5" />
                        <textarea
                          value={overviewForm.address}
                          onChange={(event) => handleOverviewChange("address", event.target.value)}
                          placeholder="Street, postal code, city, country"
                          className="min-h-[84px] w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 resize-y"
                        />
                      </div>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Website</span>
                      <div className="relative mt-1">
                        <Globe className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={overviewForm.website}
                          onChange={(event) => handleOverviewChange("website", event.target.value)}
                          placeholder="https://your-company.com"
                          className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-blue-400"
                        />
                      </div>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Organization Summary</span>
                      <textarea
                        value={overviewForm.description}
                        onChange={(event) => handleOverviewChange("description", event.target.value)}
                        placeholder="Describe the organization and clinical focus."
                        className="mt-1 min-h-[104px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 resize-y"
                      />
                    </label>
                  </div>
                </div>
              </div>
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
