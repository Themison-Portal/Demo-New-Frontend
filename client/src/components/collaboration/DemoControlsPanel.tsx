/**
 * DemoControlsPanel.tsx
 * A floating demo controls panel for simulating incoming clinical trial emails.
 * Hidden behind a small "Demo" button — click to expand, pick a template, fire.
 */

import { useState } from "react";
import { getAuth0Client } from "@/auth/auth0Provider";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmailTemplate = {
    id: string;
    label: string;
    tag: string;
    tagColor: string;
    sender_name: string;
    sender_email: string;
    subject: string;
    body: string;
    labels: string[];
    ai_summary: string;
    folder: "inbox";
};

type DemoControlsPanelProps = {
    onEmailSimulated?: () => void; // called after email is saved — reload inbox
};

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: EmailTemplate[] = [
    {
        id: "sponsor-timing",
        label: "Sponsor — Visit 3 timing query",
        tag: "Sponsor",
        tagColor: "#2563eb",
        sender_name: "Sponsor Operations",
        sender_email: "sponsor.ops@cro-example.com",
        subject: "Visit 3 blood sample timing confirmation",
        body: "Dear Study Team,\n\nWe would like to confirm the Visit 3 blood sample timing window as per Protocol Section 5.5.3. Please confirm whether the +/-2 hour window applies to all sites, including remote locations.\n\nKind regards,\nSponsor Operations",
        folder: "inbox",
        labels: ["sponsor_query", "action_required"],
        ai_summary: "Sponsor requesting confirmation of Visit 3 blood sample timing window.",
    },
    {
        id: "lab-excursion",
        label: "Central Lab — Temperature excursion",
        tag: "Lab Alert",
        tagColor: "#dc2626",
        sender_name: "Central Lab",
        sender_email: "alerts@central-lab.example",
        subject: "Temperature excursion — Batch L-220",
        body: "URGENT: Temperature excursion detected for Sample Kit Batch L-220 at 14:03 UTC today. Temperatures exceeded acceptable range for approximately 45 minutes.\n\nPlease confirm whether recollection is required and advise on next steps.\n\nCentral Lab Quality Team",
        folder: "inbox",
        labels: ["lab_alert", "safety_report", "urgent"],
        ai_summary: "Central lab flagged a temperature excursion on Sample Kit Batch L-220.",
    },
    {
        id: "site-clarification",
        label: "Site — Protocol clarification",
        tag: "Site",
        tagColor: "#7c3aed",
        sender_name: "Frontdesk CH",
        sender_email: "frontdesk.ch@site17.example",
        subject: "Protocol clarification — Visit 2 predose window",
        body: "Hi,\n\nSite Antwerp has a question about the Visit 2 predose assessment window. Can ECG be run 30 minutes after predose labs, or must it be simultaneous?\n\nWe have a patient scheduled for tomorrow and want to confirm before proceeding.\n\nBest,\nFrontdesk CH",
        folder: "inbox",
        labels: ["protocol_clarification", "action_required"],
        ai_summary: "Site Antwerp asking for clarification on Visit 2 predose assessment window.",
    },
    {
        id: "irb-update",
        label: "IRB — Amendment acknowledgment",
        tag: "Regulatory",
        tagColor: "#059669",
        sender_name: "IRB Committee",
        sender_email: "irb@ethics-board.example",
        subject: "IRB Acknowledgment — Protocol Amendment v3",
        body: "This is to confirm that the IRB has received and reviewed Protocol Amendment v3 submitted on behalf of your study.\n\nThe amendment has been acknowledged. No additional review is required at this time. Please ensure all site staff are briefed on the updated procedures.\n\nIRB Committee",
        folder: "inbox",
        labels: ["irb_correspondence", "fyi"],
        ai_summary: "IRB acknowledged Protocol Amendment v3. No additional review required.",
    },
    {
        id: "ctms-enrollment",
        label: "CTMS — Enrollment update",
        tag: "System",
        tagColor: "#64748b",
        sender_name: "CTMS System",
        sender_email: "notifications@ctms.local",
        subject: "CTMS Enrollment Update — 2 new patients screened",
        body: "Automated notification: 2 new patients have been screened and added to the trial roster.\n\nPatient IDs: PT-0047, PT-0048\nScreening date: Today\nSite: Copenhagen\n\nNo action required. This is an automated message.",
        folder: "inbox",
        labels: ["system_notification", "fyi"],
        ai_summary: "Enrollment update: 2 new patients screened at Copenhagen site.",
    },
];

// ─── API call ─────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.DEV ? "/api/be" : (import.meta.env.VITE_API_URL ?? "");

async function postSimulatedEmail(template: EmailTemplate): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // Attach the Auth0 token so this works when AUTH_DISABLED=false.
    const auth0 = getAuth0Client();
    if (auth0) {
        try {
            if (await auth0.isAuthenticated()) {
                const token = await auth0.getTokenSilently();
                if (token) headers["Authorization"] = `Bearer ${token}`;
            }
        } catch (err) {
            console.warn("[DemoControlsPanel] getTokenSilently failed", err);
        }
    }
    const res = await fetch(`${API_URL}/api/inbox/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            sender_name: template.sender_name,
            sender_email: template.sender_email,
            to_addresses: ["demo@themison.com"],
            cc_addresses: [],
            subject: template.subject,
            body: template.body,
            labels: template.labels,
            ai_summary: template.ai_summary,
            folder: template.folder,
        }),
    });
    if (!res.ok) throw new Error(`Failed to simulate email: ${res.status}`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DemoControlsPanel({ onEmailSimulated }: DemoControlsPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState<string | null>(null);
    const [lastSent, setLastSent] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSimulate = async (template: EmailTemplate) => {
        setLoading(template.id);
        setError(null);
        setLastSent(null);
        try {
            await postSimulatedEmail(template);
            setLastSent(template.label);
            onEmailSimulated?.();
            setTimeout(() => setLastSent(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to simulate email");
        } finally {
            setLoading(null);
        }
    };

    return (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, fontFamily: "Inter, sans-serif" }}>
            {/* Panel */}
            {isOpen && (
                <div style={{
                    position: "absolute",
                    bottom: 52,
                    right: 0,
                    width: 320,
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                    overflow: "hidden",
                }}>
                    {/* Header */}
                    <div style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f1f5f9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "#f8fafc",
                    }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>Demo Controls</div>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>Simulate incoming emails</div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 4 }}
                        >
                            ✕
                        </button>
                    </div>

                    {/* Templates */}
                    <div style={{ padding: "8px 0" }}>
                        {TEMPLATES.map((template) => (
                            <button
                                key={template.id}
                                onClick={() => handleSimulate(template)}
                                disabled={loading === template.id}
                                style={{
                                    width: "100%",
                                    padding: "10px 16px",
                                    background: loading === template.id ? "#f8fafc" : "none",
                                    border: "none",
                                    cursor: loading === template.id ? "wait" : "pointer",
                                    textAlign: "left",
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    transition: "background 0.15s",
                                }}
                                onMouseEnter={e => { if (loading !== template.id) (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; }}
                                onMouseLeave={e => { if (loading !== template.id) (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                            >
                                <span style={{
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: "#fff",
                                    background: template.tagColor,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    marginTop: 2,
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                }}>
                                    {template.tag}
                                </span>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: "#1e293b", lineHeight: 1.4 }}>
                                        {loading === template.id ? "Sending..." : template.label}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                                        {template.subject}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Status */}
                    {(lastSent || error) && (
                        <div style={{
                            padding: "10px 16px",
                            borderTop: "1px solid #f1f5f9",
                            fontSize: 12,
                            color: error ? "#dc2626" : "#059669",
                            background: error ? "#fef2f2" : "#f0fdf4",
                        }}>
                            {error ? `⚠ ${error}` : `✓ Sent: ${lastSent}`}
                        </div>
                    )}
                </div>
            )}

            {/* Toggle button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: isOpen ? "#1e293b" : "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "background 0.15s",
                }}
            >
                <span>⚡</span>
                Demo
            </button>
        </div>
    );
}
