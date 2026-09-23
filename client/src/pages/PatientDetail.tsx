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
import { useDemoState } from "@/contexts/DemoStateContext";

interface PatientDetailProps {
    trialId: string;
    patientId: string;
}

const TABS = ["Overview", "Visits", "Costs", "Medical", "Documents"] as const;
type Tab = (typeof TABS)[number];

export default function PatientDetail({ trialId, patientId }: PatientDetailProps) {
    const [, navigate] = useLocation();
    const { getCurrentDataMode } = useDemoState();
    const currentDataMode = getCurrentDataMode();
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
        { trialId, demoMode: currentDataMode },
        { enabled: Boolean(trialId) }
    );

    const visitsQuery = trpc.patients.listVisits.useQuery(
        { patientId, trialId, demoMode: currentDataMode },
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
        if (patientsQuery.data && patientsQuery.data.length > 0) {
            const found = patientsQuery.data.find((p) => p.patient_id === patientId || p.patient_code === patientId);
            if (found) return found;
        }
        // Fallback demo patient matching Figma spec (PAT-08385 / John Doe)
        return {
            id: 1,
            patient_id: patientId || "PAT-08385",
            patient_code: patientId || "PAT-08385",
            patient_first_name: "John",
            patient_last_name: "Doe",
            status: "active",
            trial_id: trialId || "1",
            enrollment_date: "2026-09-21",
            notes: "Patient tolerating Arm A therapy well. Next visit requires fasting and stool sample collection.",
            patient_data: {
                date_of_birth: "1972-04-12",
                gender: "male",
                screening_notes: "Arm A (Sym004 + FOLFIRI) · Site 01",
                email: "j.doe@example.com",
                phone_number: "+1 (555) 234-5678",
                consent_date: "2026-09-20",
            },
        };
    }, [patientsQuery.data, patientId, trialId]);

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
            demoMode: currentDataMode,
            visitDate: visitForm.visitDate,
            visitTime: visitForm.visitTime,
            visitType: visitForm.visitType,
            notes: visitForm.notes,
            location: visitForm.location,
        });
    };

    if (patientsQuery.isLoading && !patient) {
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
            <div className="bg-white border-b border-gray-200 px-6 pt-5 pb-0">
                {/* Back button & Breadcrumb */}
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                    <button
                        onClick={() => navigate(`/trial/${trialId}?tab=patients`)}
                        className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors font-medium"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" /> Back to patients
                    </button>
                    <span className="text-gray-300">/</span>
                    <span className="font-mono text-gray-700 font-medium">{patient.patient_code}</span>
                </div>

                {/* Patient Header Main Info */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                    <div className="flex items-start gap-4">
                        <Avatar className="h-14 w-14 rounded-full bg-indigo-600 text-white font-bold text-xl ring-4 ring-indigo-50 shrink-0">
                            <AvatarFallback className="bg-indigo-600 text-white text-lg font-bold">{initials}</AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-gray-950">
                                    {patient.patient_first_name} {patient.patient_last_name}
                                </h1>
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 gap-1.5 capitalize">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    {patient.status}
                                </span>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                    {patient.patient_code}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-1 font-medium">
                                <span>
                                    {patient.patient_data?.date_of_birth
                                        ? `${new Date().getFullYear() - new Date(patient.patient_data.date_of_birth).getFullYear()} y`
                                        : "54 y"}
                                </span>
                                <span>·</span>
                                <span>
                                    {patient.patient_data?.gender
                                        ? patient.patient_data.gender.charAt(0).toUpperCase()
                                        : "M"}
                                </span>
                                <span className="text-gray-300">|</span>
                                <span className="text-indigo-700 font-semibold bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100/60">
                                    Arm A (Sym004 + FOLFIRI)
                                </span>
                                <span className="text-gray-300">|</span>
                                <span>Site 01</span>
                                <span className="text-gray-300">|</span>
                                <span>Enrolled {enrollmentDate}</span>
                            </div>
                        </div>
                    </div>

                    {/* Action Header Buttons */}
                    <div className="flex items-center gap-2.5 shrink-0">
                        <Button
                            variant="outline"
                            onClick={() => toast.info(`Message dialog opened for ${patient.patient_first_name}`)}
                            className="border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-medium h-9 px-3.5 flex items-center gap-1.5"
                        >
                            <MessageCircle className="h-3.5 w-3.5 text-gray-500" />
                            Message
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setIsScheduleVisitDialogOpen(true)}
                            className="border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-medium h-9 px-3.5 flex items-center gap-1.5"
                        >
                            <Calendar className="h-3.5 w-3.5 text-gray-500" />
                            Reschedule visit
                        </Button>
                        <Button
                            onClick={() => setIsScheduleVisitDialogOpen(true)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium h-9 px-4 flex items-center gap-1.5 shadow-sm"
                        >
                            <Plus className="h-4 w-4" />
                            Record visit
                        </Button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 pt-3">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${activeTab === tab
                                ? "border-indigo-600 text-indigo-600 bg-indigo-50/30"
                                : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Pending Alert Banner ─────────────────────────────────────── */}
            <div className="px-6 pt-4">
                <div className="bg-amber-50/90 border border-amber-200/80 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-amber-900 shadow-sm">
                    <div className="flex items-center gap-2.5">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span className="font-medium">
                            <strong className="font-semibold text-amber-950">1 assessment still pending</strong> from Visit 5 (Fecal Calprotectin) — complete before Visit 6 on 05 Oct.
                        </span>
                    </div>
                    <button
                        onClick={() => setActiveTab("Visits")}
                        className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline flex items-center gap-1 shrink-0 ml-4"
                    >
                        View visit &rarr;
                    </button>
                </div>
            </div>

            {/* ── Main Dashboard Body ──────────────────────────────────────── */}
            <div className="px-6 pt-4">
                {/* OVERVIEW TAB */}
                {activeTab === "Overview" && (
                    <div className="space-y-5">
                        {/* 3 KPI Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Card 1: STUDY PROGRESS */}
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5 flex flex-col justify-between">
                                <div>
                                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                        STUDY PROGRESS
                                    </p>
                                    <div className="flex items-baseline justify-between">
                                        <p className="text-2xl font-extrabold text-gray-950">{completedVisits || 5} of {totalVisits || 13} visits</p>
                                        <span className="text-xs font-semibold text-indigo-600 font-mono">
                                            {totalVisits > 0 ? Math.round(((completedVisits || 5) / (totalVisits || 13)) * 100) : 38}%
                                        </span>
                                    </div>
                                    <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                                            style={{ width: `${totalVisits > 0 ? ((completedVisits || 5) / (totalVisits || 13)) * 100 : 38}%` }}
                                        />
                                    </div>
                                </div>
                                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 font-medium">
                                    <span>Week 12 of 53</span>
                                    <span>{(totalVisits || 13) - (completedVisits || 5)} visits remaining</span>
                                </div>
                            </div>

                            {/* Card 2: NEXT VISIT */}
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5 flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                            NEXT VISIT
                                        </p>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                            Due in 3d
                                        </span>
                                    </div>
                                    <p className="text-lg font-bold text-gray-950">Visit 6 — Week 12</p>
                                    <p className="text-xs text-gray-500 mt-0.5 font-medium">
                                        05 Oct 2026, 09:00 · Main Clinical Site
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-3">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                                            &plusmn;3d window
                                        </span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                                            9 activities
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsScheduleVisitDialogOpen(true)}
                                        className="text-xs text-gray-600 hover:text-gray-900 h-8 px-2.5 font-medium"
                                    >
                                        Reschedule
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toast.success("Visit reminder sent to patient via SMS & Email!")}
                                        className="text-xs text-indigo-700 border-indigo-200 hover:bg-indigo-50 h-8 px-3 font-semibold ml-auto"
                                    >
                                        Send reminder
                                    </Button>
                                </div>
                            </div>

                            {/* Card 3: ADHERENCE & PREP */}
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5 flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                            ADHERENCE &amp; PREP
                                        </p>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                            On plan
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 font-medium mb-3">Across last 3 visits</p>
                                    <div className="space-y-2 text-xs font-medium">
                                        <div className="flex items-center gap-2 text-gray-700">
                                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                                            <span>Bowel prep instructions sent for Visit 6</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-gray-700">
                                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                                            <span>Fasting reminder confirmed</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-amber-800 font-semibold bg-amber-50/60 px-2 py-1 rounded border border-amber-100/60">
                                            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                                            <span>Study drug diary — 2 entries missed</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Main 2-Column Section (Visit Schedule & Quick Actions) */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                            {/* Left Column (2/3): Visit Schedule */}
                            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-base font-bold text-gray-950">Visit schedule</h3>
                                        <p className="text-xs text-gray-400 font-medium mt-0.5">
                                            Detailed history and upcoming protocol visits
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setActiveTab("Visits")}
                                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                    >
                                        Open Visits tab &rarr;
                                    </button>
                                </div>

                                <div className="divide-y divide-gray-100">
                                    {[
                                        { name: "Screening · Day -14", tests: "8 / 8 tests", status: "Completed", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                        { name: "Baseline · Wk 0", tests: "11 / 11 tests", status: "Completed", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                        { name: "Visit 3 · Wk 2", tests: "8 / 8 tests", status: "Completed", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                        { name: "Visit 4 · Wk 4", tests: "10 / 10 tests", status: "Completed", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                        { name: "Visit 5 · Wk 8", tests: "13 / 14 tests", status: "1 pending", statusStyle: "bg-amber-50 text-amber-700 border-amber-200 font-bold" },
                                        { name: "Visit 6 · Wk 12", tests: "0 / 9 tests", status: "Next · Due in 3d", statusStyle: "bg-blue-50 text-blue-700 border-blue-200 font-bold" },
                                        { name: "Visit 7 · Wk 16", tests: "—", status: "Upcoming", statusStyle: "bg-gray-100 text-gray-600 border-gray-200" },
                                    ].map((v, idx) => (
                                        <div
                                            key={idx}
                                            className={`px-6 py-3.5 flex items-center justify-between hover:bg-gray-50/80 transition-colors ${
                                                v.status.includes("Next") ? "bg-blue-50/20" : ""
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center font-semibold text-gray-700 text-xs">
                                                    V{idx + 1}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-gray-900">{v.name}</p>
                                                    <p className="text-xs text-gray-400 font-medium">{v.tests}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${v.statusStyle}`}>
                                                    {v.status}
                                                </span>
                                                <button
                                                    onClick={() => setActiveTab("Visits")}
                                                    className="p-1 text-gray-400 hover:text-gray-700 rounded"
                                                >
                                                    &rarr;
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right Column (1/3): Quick Actions & Case Notes */}
                            <div className="space-y-5">
                                {/* Quick Actions Card */}
                                <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5">
                                    <h3 className="text-sm font-bold text-gray-950 mb-3">Quick actions</h3>
                                    <div className="space-y-2">
                                        {[
                                            { label: "Schedule / reschedule a visit", icon: Calendar, action: () => setIsScheduleVisitDialogOpen(true) },
                                            { label: "Record visit outcome", icon: FileCheck, action: () => setIsScheduleVisitDialogOpen(true) },
                                            { label: "Send visit reminder", icon: Mail, action: () => toast.success("Visit reminder sent via SMS!") },
                                            { label: "Send prep instructions", icon: ClipboardList, action: () => toast.success("Prep instructions sent to patient app!") },
                                            { label: "Message coordinator", icon: MessageCircle, action: () => toast.info("Coordinator message window opened.") },
                                        ].map((act, index) => (
                                            <button
                                                key={index}
                                                onClick={act.action}
                                                className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-200/80 hover:border-indigo-200 hover:bg-indigo-50/40 text-xs font-semibold text-gray-800 transition-all text-left group"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <act.icon className="h-4 w-4 text-gray-400 group-hover:text-indigo-600 transition-colors shrink-0" />
                                                    <span>{act.label}</span>
                                                </div>
                                                <span className="text-gray-300 group-hover:text-indigo-600 transition-colors">&rarr;</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Coordinator Notes Card */}
                                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                                            <ClipboardList className="h-4 w-4 text-indigo-600" /> Coordinator Case Notes
                                        </h4>
                                    </div>
                                    <p className="text-xs text-indigo-900/90 leading-relaxed bg-white p-3 rounded-lg border border-indigo-100/80 shadow-2xs font-medium">
                                        {patient.notes || "Patient tolerating Arm A therapy well. Next visit requires fasting and stool sample collection."}
                                    </p>
                                </div>
                            </div>
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
