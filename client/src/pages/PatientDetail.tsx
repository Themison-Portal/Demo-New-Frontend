import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
    ArrowLeft,
    Calendar,
    Clock,
    User,
    Plus,
    Phone,
    Mail,
    CheckCircle2,
    X,
    MapPin,
    FileCheck,
    ClipboardList,
    AlertTriangle,
    Flag,
    MessageCircle,
    FlaskConical,
    FileText,
    Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface PatientDetailProps {
    trialId: string;
    patientId: string;
}

const TABS = ["Overview", "Visits", "Costs", "Medical", "Documents"] as const;
type Tab = (typeof TABS)[number];

export default function PatientDetail({ trialId, patientId }: PatientDetailProps) {
    const [, navigate] = useLocation();
    const [activeTab, setActiveTab] = useState<Tab>("Overview");
    const [isScheduleVisitDialogOpen, setIsScheduleVisitDialogOpen] = useState(false);
    const [visitForm, setVisitForm] = useState({
        visitDate: new Date().toISOString().split("T")[0],
        visitTime: "09:00",
        visitType: "follow_up",
        notes: "",
        location: "Main Clinic",
    });

    const patientsQuery = trpc.patients.listByTrial.useQuery(
        { trialId },
        { enabled: Boolean(trialId) }
    );

    const visitsQuery = trpc.patients.listVisits.useQuery(
        { patientId, trialId },
        { enabled: Boolean(patientId && trialId) }
    );

    const createVisitMutation = trpc.patients.createVisit.useMutation({
        onSuccess: () => {
            toast.success("Visit successfully scheduled!");
            setIsScheduleVisitDialogOpen(false);
            setVisitForm({
                visitDate: new Date().toISOString().split("T")[0],
                visitTime: "09:00",
                visitType: "follow_up",
                notes: "",
                location: "Main Clinic",
            });
            void visitsQuery.refetch();
        },
        onError: (error) => {
            console.error("Failed to schedule visit:", error);
            toast.error("Failed to schedule patient visit");
        },
    });

    const patient = useMemo(() => {
        if (!patientsQuery.data) return null;
        return patientsQuery.data.find((p) => p.patient_id === patientId) || null;
    }, [patientsQuery.data, patientId]);

    const stats = useMemo(() => {
        const visits = visitsQuery.data || [];
        const scheduled = visits.filter((v) => v.status === "scheduled").length;
        const completed = visits.filter((v) => v.status === "completed" || v.status === "done").length;
        return { total: visits.length, scheduled, completed };
    }, [visitsQuery.data]);

    const handleScheduleVisitSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createVisitMutation.mutate({
            patientId,
            trialId,
            visitDate: visitForm.visitDate,
            visitTime: visitForm.visitTime,
            visitType: visitForm.visitType,
            notes: visitForm.notes,
            location: visitForm.location,
        });
    };

    if (patientsQuery.isLoading) {
        return (
            <div className="py-32 flex flex-col items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4" />
                <p className="text-gray-500 font-medium text-sm">Loading patient profile...</p>
            </div>
        );
    }

    if (!patient) {
        return (
            <div className="py-24 text-center">
                <User className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900">Patient Profile Not Found</h3>
                <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">
                    The requested participant does not exist or has been unenrolled.
                </p>
                <Button
                    onClick={() => navigate(`/trial/${trialId}?tab=patients`)}
                    className="mt-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center gap-1.5 mx-auto text-sm"
                >
                    <ArrowLeft className="h-4 w-4" /> Back to Study Cohort
                </Button>
            </div>
        );
    }

    const initials = `${patient.patient_first_name?.[0] || ""}${patient.patient_last_name?.[0] || ""}`;
    const enrollmentDate = patient.enrollment_date
        ? new Date(patient.enrollment_date).toLocaleDateString("en-GB", {
            day: "2-digit", month: "2-digit", year: "numeric",
        })
        : "N/A";

    // Visit progress — total visits from visits data
    const completedVisits = stats.completed;
    const totalVisits = stats.total || 13;
    const visitProgressPct = totalVisits > 0 ? Math.round((completedVisits / totalVisits) * 100) : 0;

    return (
        <div className="min-h-full bg-gray-50/40 pb-12">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="bg-white border-b border-gray-200 px-6 pt-4 pb-0">
                {/* Back + patient identity */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => navigate(`/trial/${trialId}?tab=patients`)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {patient.patient_code}
                            </span>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200 capitalize">
                                {patient.status}
                            </span>
                        </div>
                    </div>
                    <Button
                        onClick={() => setIsScheduleVisitDialogOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5 text-sm px-4 py-2 font-medium shadow-sm"
                    >
                        <Plus className="h-4 w-4" /> Schedule Visit
                    </Button>
                </div>

                <h1 className="text-2xl font-bold text-gray-950 mb-1">
                    {patient.patient_first_name} {patient.patient_last_name}
                </h1>
                <p className="text-xs text-gray-400 mb-4">
                    Age {patient.patient_data?.date_of_birth
                        ? new Date().getFullYear() - new Date(patient.patient_data.date_of_birth).getFullYear()
                        : "—"} ·{" "}
                    {patient.patient_data?.gender
                        ? patient.patient_data.gender.charAt(0).toUpperCase() + patient.patient_data.gender.slice(1)
                        : "—"} ·{" "}
                    {patient.patient_data?.screening_notes || "Clinical trial participant"} ·{" "}
                    Enrolled: {enrollmentDate}
                </p>

                {/* Tabs */}
                <div className="flex items-center gap-1">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${activeTab === tab
                                ? "border-indigo-600 text-indigo-600 bg-indigo-50/40"
                                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Stat cards ──────────────────────────────────────────────── */}
            <div className="px-6 pt-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
                        <div className="h-11 w-11 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                            <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total Visits Logged</p>
                            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.total}</p>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
                        <div className="h-11 w-11 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
                            <Calendar className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Upcoming Scheduled</p>
                            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.scheduled}</p>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
                        <div className="h-11 w-11 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                            <FileCheck className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Completed / Checked</p>
                            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.completed}</p>
                        </div>
                    </div>
                </div>

                {/* ── Tab content ─────────────────────────────────────────────── */}

                {/* OVERVIEW TAB */}
                {activeTab === "Overview" && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        {/* Left — demographics */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
                            <div className="flex flex-col items-center text-center pb-5 border-b border-gray-100">
                                <Avatar className="h-20 w-20 rounded-full bg-indigo-100 text-indigo-600 font-bold text-2xl">
                                    <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xl font-bold">{initials}</AvatarFallback>
                                </Avatar>
                                <h3 className="font-bold text-gray-950 text-lg mt-3">
                                    {patient.patient_first_name} {patient.patient_last_name}
                                </h3>
                                <p className="text-xs font-mono text-indigo-600 mt-0.5">{patient.patient_code}</p>
                                {patient.patient_data?.email && (
                                    <span className="flex items-center gap-1 text-xs text-gray-400 mt-2">
                                        <Mail className="h-3.5 w-3.5" /> {patient.patient_data.email}
                                    </span>
                                )}
                                {patient.patient_data?.phone_number && (
                                    <span className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                                        <Phone className="h-3.5 w-3.5" /> {patient.patient_data.phone_number}
                                    </span>
                                )}
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                    Participant Demographics
                                </p>
                                <div className="space-y-2.5 text-xs">
                                    {[
                                        ["Date of Birth", patient.patient_data?.date_of_birth
                                            ? new Date(patient.patient_data.date_of_birth).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                                            : "N/A"],
                                        ["Gender", patient.patient_data?.gender
                                            ? patient.patient_data.gender.charAt(0).toUpperCase() + patient.patient_data.gender.slice(1)
                                            : "N/A"],
                                        ["Study Status", patient.status],
                                        ["Enrollment Date", patient.enrollment_date
                                            ? new Date(patient.enrollment_date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                                            : "N/A"],
                                    ].map(([label, value]) => (
                                        <div key={label} className="flex justify-between">
                                            <span className="text-gray-400">{label}</span>
                                            <span className="font-medium text-gray-900 capitalize text-right max-w-[55%]">{value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-gray-100">
                                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                    Consent & Validation
                                </p>
                                <div className="space-y-2.5 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-400">Informed Consent Status</span>
                                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                                            <CheckCircle2 className="h-3 w-3" /> Signed
                                        </span>
                                    </div>
                                    {patient.patient_data?.consent_date && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Consent Date</span>
                                            <span className="font-medium text-gray-900">
                                                {new Date(patient.patient_data.consent_date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                                            </span>
                                        </div>
                                    )}
                                    {patient.patient_data?.screening_notes && (
                                        <div className="pt-1">
                                            <p className="text-gray-400 mb-1">Screening Notes</p>
                                            <p className="text-gray-600 bg-gray-50 p-2.5 rounded-lg leading-relaxed border border-gray-100">
                                                {patient.patient_data.screening_notes}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right — overview cards */}
                        <div className="lg:col-span-2 space-y-4">
                            {/* Visit current summary */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="text-base font-semibold text-green-600">
                                            Visit {completedVisits + 1} – Week {completedVisits * 4}
                                        </h3>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            Today, {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                        </p>
                                    </div>
                                </div>
                                {/* Activity rows */}
                                {[
                                    { label: "Laboratory", done: 10, total: 10, color: "bg-green-500" },
                                    { label: "Vital Signs", done: 4, total: 4, color: "bg-green-500" },
                                    { label: "Physical Exam", done: 1, total: 1, color: "bg-green-500" },
                                    { label: "Safety Assessment", done: 3, total: 3, color: "bg-green-500" },
                                ].map((item) => (
                                    <div key={item.label} className="flex items-center gap-3 mb-3">
                                        <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                            <span className="text-[9px] font-bold text-gray-500">
                                                {item.label.slice(0, 2).toUpperCase()}
                                            </span>
                                        </div>
                                        <span className="text-sm text-gray-700 min-w-[120px]">{item.label}</span>
                                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${item.color}`}
                                                style={{ width: `${(item.done / item.total) * 100}%` }}
                                            />
                                        </div>
                                        <span className="text-xs font-semibold text-gray-700 w-10 text-right">
                                            {item.done}/{item.total}
                                        </span>
                                    </div>
                                ))}
                                <div className="mt-3">
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-100">
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Visit {completedVisits} Completed
                                    </span>
                                </div>
                            </div>

                            {/* Study Progress + Next Visit */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Study Progress</h3>
                                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                                        <span>Treatment Phase</span>
                                        <span>{completedVisits}/{totalVisits} visits</span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${visitProgressPct}%` }} />
                                    </div>
                                    <p className="text-xs font-semibold text-green-600 mb-4">
                                        Week {completedVisits * 4}/53
                                    </p>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        {[
                                            { label: "Completed", value: completedVisits, bg: "bg-gray-50" },
                                            { label: "Scheduled", value: stats.scheduled, bg: "bg-amber-50" },
                                            { label: "Remaining", value: Math.max(0, totalVisits - completedVisits - stats.scheduled), bg: "bg-gray-50" },
                                        ].map((item) => (
                                            <div key={item.label} className={`${item.bg} rounded-lg p-2`}>
                                                <p className="text-xl font-bold text-gray-900">{item.value}</p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">{item.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Next Visit:</h3>
                                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-3">
                                        <p className="text-sm font-semibold text-gray-900">
                                            Visit {completedVisits + 1} – Week {(completedVisits + 1) * 4}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", {
                                                day: "2-digit", month: "2-digit", year: "numeric",
                                            })} at 9:00
                                        </p>
                                        <p className="text-xs text-gray-400 mt-0.5">Main Clinical Site · 9 Activities</p>
                                    </div>
                                    <Button
                                        onClick={() => setIsScheduleVisitDialogOpen(true)}
                                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg h-9"
                                    >
                                        Send Reminder
                                    </Button>
                                </div>
                            </div>

                            {/* Safety Status */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                <h3 className="text-sm font-semibold text-gray-900 mb-3">Safety Status</h3>
                                <div className="flex items-center gap-2 mb-3 text-sm">
                                    <span className="text-gray-500">Flagged:</span>
                                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">0</span>
                                </div>
                                <div className="text-xs text-gray-500 space-y-1.5">
                                    <div>Serious AEs: <span className="font-semibold text-green-600">None</span></div>
                                    <div>Protocol Deviations: <span className="font-semibold text-green-600">None</span></div>
                                </div>
                            </div>

                            {/* Quick Actions */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { label: "Flag Issue", icon: Flag, color: "text-red-500" },
                                        { label: "Contact", icon: MessageCircle, color: "text-gray-500" },
                                        { label: "Schedule Visit", icon: Calendar, color: "text-indigo-500", onClick: () => setIsScheduleVisitDialogOpen(true) },
                                        { label: "Lab Results", icon: FlaskConical, color: "text-green-500" },
                                    ].map((action) => (
                                        <button
                                            key={action.label}
                                            onClick={action.onClick}
                                            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 font-medium transition-colors"
                                        >
                                            <action.icon className={`h-4 w-4 ${action.color}`} />
                                            {action.label}
                                        </button>
                                    ))}
                                </div>
                                <Button
                                    onClick={() => setActiveTab("Visits")}
                                    className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg h-9"
                                >
                                    Generate Visit Report
                                </Button>
                            </div>

                            {/* Coordinator notes */}
                            {patient.notes && (
                                <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-5">
                                    <h4 className="text-sm font-semibold text-indigo-900 flex items-center gap-1.5 mb-2">
                                        <ClipboardList className="h-4 w-4 text-indigo-600" /> Coordinator Case Notes
                                    </h4>
                                    <p className="text-xs text-indigo-800 leading-relaxed bg-white p-3 rounded-lg border border-indigo-100">
                                        {patient.notes}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* VISITS TAB */}
                {activeTab === "Visits" && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                        {/* Visit progress bar */}
                        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
                            <div className="flex items-center justify-between mb-1">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900">Visit Progress</h3>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {completedVisits} out of {totalVisits} treatment visits completed
                                    </p>
                                </div>
                                <div className="text-right text-xs text-gray-500">
                                    <span>Current visit: Visit {completedVisits} (week {completedVisits * 4})</span>
                                </div>
                            </div>
                            <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${visitProgressPct}%` }} />
                            </div>
                        </div>

                        {/* Visit list */}
                        {visitsQuery.isLoading ? (
                            <div className="py-16 flex items-center justify-center text-sm text-gray-400">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mr-2" />
                                Loading visits...
                            </div>
                        ) : !visitsQuery.data || visitsQuery.data.length === 0 ? (
                            <div className="py-20 text-center">
                                <Calendar className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                                <p className="text-sm font-semibold text-gray-700">No Visits Logged</p>
                                <p className="text-xs text-gray-400 mt-1">Schedule the first visit to get started.</p>
                                <Button
                                    onClick={() => setIsScheduleVisitDialogOpen(true)}
                                    className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg px-4 h-9"
                                >
                                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Schedule Visit
                                </Button>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {visitsQuery.data.map((visit, index) => {
                                    const isCompleted = visit.status === "completed" || visit.status === "done";
                                    const isScheduled = visit.status === "scheduled";
                                    return (
                                        <div
                                            key={visit.id}
                                            className={`flex items-center gap-4 px-6 py-4 ${isScheduled ? "bg-blue-50/30" : ""}`}
                                        >
                                            {/* Visit number + type */}
                                            <div className="min-w-[120px]">
                                                <p className="text-sm font-semibold text-gray-900">
                                                    Visit {index + 1}
                                                </p>
                                                <p className="text-xs text-gray-400 capitalize mt-0.5">
                                                    {visit.visit_type.replace(/_/g, " ")}
                                                </p>
                                            </div>

                                            {/* Week number */}
                                            <div className="w-10 text-xs text-gray-400 font-mono text-center">
                                                {index * 4}
                                            </div>

                                            {/* Date */}
                                            <div className="min-w-[90px] text-xs text-gray-600 font-medium">
                                                {new Date(visit.visit_date).toLocaleDateString("en-GB", {
                                                    day: "2-digit", month: "2-digit", year: "numeric",
                                                })}
                                            </div>

                                            {/* Status badge */}
                                            <div className="min-w-[100px]">
                                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${isCompleted
                                                    ? "bg-green-100 text-green-700"
                                                    : isScheduled
                                                        ? "bg-blue-100 text-blue-700"
                                                        : "bg-gray-100 text-gray-600"
                                                    }`}>
                                                    {isCompleted && <CheckCircle2 className="h-3 w-3" />}
                                                    {isCompleted ? "Completed" : isScheduled ? "Scheduled" : visit.status}
                                                </span>
                                            </div>

                                            {/* Activities / notes */}
                                            <div className="flex-1 text-xs text-gray-500 truncate">
                                                {visit.notes || "—"}
                                            </div>

                                            {/* Location */}
                                            {visit.location && (
                                                <div className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                                                    <MapPin className="h-3 w-3" /> {visit.location}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* COSTS TAB */}
                {activeTab === "Costs" && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
                        <Activity className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-gray-700">Cost Tracking</p>
                        <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                            Visit cost data and budget tracking will appear here once configured.
                        </p>
                    </div>
                )}

                {/* MEDICAL TAB */}
                {activeTab === "Medical" && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
                        <FlaskConical className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-gray-700">Medical Records</p>
                        <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                            Lab results, vitals, and medical history will appear here.
                        </p>
                    </div>
                )}

                {/* DOCUMENTS TAB */}
                {activeTab === "Documents" && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
                        <FileText className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-gray-700">Patient Documents</p>
                        <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                            Consent forms, lab reports, and uploaded files will appear here.
                        </p>
                    </div>
                )}
            </div>

            {/* ── Schedule Visit Dialog ────────────────────────────────────── */}
            <Dialog open={isScheduleVisitDialogOpen} onOpenChange={setIsScheduleVisitDialogOpen}>
                <DialogContent className="sm:max-w-[480px] rounded-2xl bg-white p-6 shadow-2xl">
                    <DialogHeader className="pb-4 border-b border-gray-100">
                        <DialogTitle className="text-lg font-bold text-gray-950">Schedule Patient Visit</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleScheduleVisitSubmit} className="space-y-4 pt-4 text-xs">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="font-semibold text-gray-900">Visit Date</label>
                                <Input
                                    type="date"
                                    required
                                    value={visitForm.visitDate}
                                    onChange={(e) => setVisitForm({ ...visitForm, visitDate: e.target.value })}
                                    className="rounded-lg border-gray-200 text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="font-semibold text-gray-900">Visit Time</label>
                                <Input
                                    type="time"
                                    required
                                    value={visitForm.visitTime}
                                    onChange={(e) => setVisitForm({ ...visitForm, visitTime: e.target.value })}
                                    className="rounded-lg border-gray-200 text-xs"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="font-semibold text-gray-900">Visit Type</label>
                                <select
                                    value={visitForm.visitType}
                                    onChange={(e) => setVisitForm({ ...visitForm, visitType: e.target.value })}
                                    className="w-full rounded-lg border border-gray-200 bg-white text-xs py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                >
                                    <option value="screening">Screening</option>
                                    <option value="baseline">Baseline</option>
                                    <option value="follow_up">Follow-up</option>
                                    <option value="safety_check">Safety Check</option>
                                    <option value="end_of_treatment">End of Treatment</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="font-semibold text-gray-900">Location</label>
                                <Input
                                    type="text"
                                    required
                                    value={visitForm.location}
                                    onChange={(e) => setVisitForm({ ...visitForm, location: e.target.value })}
                                    className="rounded-lg border-gray-200 text-xs"
                                    placeholder="e.g. Room 402, Main Clinic"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="font-semibold text-gray-900">Notes / Visit Instructions</label>
                            <Textarea
                                value={visitForm.notes}
                                onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                                className="rounded-lg border-gray-200 text-xs min-h-[80px]"
                                placeholder="Include details about blood samples, drug infusions, or checklist items..."
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsScheduleVisitDialogOpen(false)}
                                className="border-gray-200 text-gray-700 text-xs rounded-lg"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={createVisitMutation.isPending}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg"
                            >
                                {createVisitMutation.isPending ? "Scheduling..." : "Schedule Visit"}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
