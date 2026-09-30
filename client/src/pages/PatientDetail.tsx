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
    Check,
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

const TABS = ["Overview", "Visits", "Costs", "Medical", "Documents", "Messaging", "Safety & AEs"] as const;
type Tab = (typeof TABS)[number];

export default function PatientDetail({ trialId, patientId }: PatientDetailProps) {
    const [, navigate] = useLocation();
    const { getCurrentDataMode } = useDemoState();
    const currentDataMode = getCurrentDataMode();
    const [activeTab, setActiveTab] = useState<Tab>("Overview");
    const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
    const [isScheduleVisitDialogOpen, setIsScheduleVisitDialogOpen] = useState(false);
    const [isEnterResultDialogOpen, setIsEnterResultDialogOpen] = useState(false);
    const [isLogExpenseOpen, setIsLogExpenseOpen] = useState(false);
    const [isAddLabOpen, setIsAddLabOpen] = useState(false);
    const [isUploadDocOpen, setIsUploadDocOpen] = useState(false);
    const [isLogAEOpen, setIsLogAEOpen] = useState(false);
    const [medicalFilter, setMedicalFilter] = useState("all");
    const [fecalCalprotectinValue, setFecalCalprotectinValue] = useState("145 µg/g");
    const [isCalprotectinDone, setIsCalprotectinDone] = useState(false);
    const [isVisit5Complete, setIsVisit5Complete] = useState(false);
    const [visitNoteText, setVisitNoteText] = useState(
        "Patient tolerating treatment well. Calprotectin sample collected on 20 Sep. Pending lab result upload..."
    );

    const [visitForm, setVisitForm] = useState({
        visitDate: new Date().toISOString().split("T")[0],
        visitTime: "09:00",
        visitType: "follow_up",
        notes: "",
        location: "Main Clinic",
    });

    // Protocol visits matching Figma spec (13 visits total)
    const protocolVisits = useMemo(() => {
        const v5Done = isCalprotectinDone || isVisit5Complete;
        return [
            { id: "visit-1", code: "Screening · Wk -2", targetDate: "Target 29 Aug 2026", status: "completed", statusLabel: "Completed", testsCompleted: 8, totalTests: 8, progressPct: 100, actionLabel: "View", actionType: "view" },
            { id: "visit-2", code: "Baseline · Wk 0", targetDate: "Target 12 Sep 2026", status: "completed", statusLabel: "Completed", testsCompleted: 11, totalTests: 11, progressPct: 100, actionLabel: "View", actionType: "view" },
            { id: "visit-3", code: "Visit 3 · Wk 2", targetDate: "Target 26 Sep 2026", status: "completed", statusLabel: "Completed", testsCompleted: 8, totalTests: 8, progressPct: 100, actionLabel: "View", actionType: "view" },
            { id: "visit-4", code: "Visit 4 · Wk 4", targetDate: "Target —", status: "completed", statusLabel: "Completed", testsCompleted: 10, totalTests: 10, progressPct: 100, actionLabel: "View", actionType: "view" },
            { id: "visit-5", code: "Visit 5 · Wk 8", targetDate: "Target 20 Sep 2026", status: v5Done ? "completed" : "pending", statusLabel: v5Done ? "Completed" : "1 test pending", testsCompleted: v5Done ? 14 : 13, totalTests: 14, progressPct: v5Done ? 100 : 92, actionLabel: v5Done ? "View" : "Complete tests", actionType: v5Done ? "view" : "complete" },
            { id: "visit-6", code: "Visit 6 · Wk 12", targetDate: "Target 05 Oct 2026, 09:00", status: "next", statusLabel: "Next - Due in 3d", testsCompleted: 0, totalTests: 9, progressPct: 0, actionLabel: "Open visit", actionType: "open", secondaryLabel: "Reschedule" },
            { id: "visit-7", code: "Visit 7 · Wk 16", targetDate: "Target 02 Nov 2026", status: "upcoming", statusLabel: "Upcoming", testsCompleted: 0, totalTests: 10, summary: "10 assessments scheduled", secondaryLabel: "Reschedule" },
            { id: "visit-8", code: "Visit 8 · Wk 20", targetDate: "Target 30 Nov 2026", status: "upcoming", statusLabel: "Upcoming", testsCompleted: 0, totalTests: 7, summary: "7 assessments scheduled", secondaryLabel: "Reschedule" },
            { id: "visit-9", code: "Visit 9 · Wk 24", targetDate: "Target 28 Dec 2026", status: "upcoming", statusLabel: "Upcoming", testsCompleted: 0, totalTests: 9, summary: "9 assessments scheduled", secondaryLabel: "Reschedule" },
            { id: "visit-10", code: "Visit 10 · Wk 32", targetDate: "Target 22 Feb 2027", status: "upcoming", statusLabel: "Upcoming", testsCompleted: 0, totalTests: 7, summary: "7 assessments scheduled", secondaryLabel: "Reschedule" },
            { id: "visit-11", code: "Visit 11 · Wk 40", targetDate: "Target 19 Apr 2027", status: "upcoming", statusLabel: "Upcoming", testsCompleted: 0, totalTests: 9, summary: "9 assessments scheduled", secondaryLabel: "Reschedule" },
            { id: "visit-12", code: "Visit 12 · Wk 48", targetDate: "Target 14 Jun 2027", status: "upcoming", statusLabel: "Upcoming", testsCompleted: 0, totalTests: 7, summary: "7 assessments scheduled", secondaryLabel: "Reschedule" },
        ];
    }, [isCalprotectinDone, isVisit5Complete]);

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
    const completedVisits = isVisit5Complete || isCalprotectinDone ? 5 : 4;
    const totalVisits = 13;
    const visitProgressPct = Math.round((completedVisits / totalVisits) * 100);
    const selectedVisitObj = selectedVisitId ? protocolVisits.find(v => v.id === selectedVisitId) || protocolVisits[4] : null;

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

            {/* ── Pending Alert Banner (only shown when pending & not in visit detail) ── */}
            {!isCalprotectinDone && !isVisit5Complete && !selectedVisitId && (
            <div className="px-6 pt-4">
                <div className="bg-amber-50/90 border border-amber-200/80 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-amber-900 shadow-sm">
                    <div className="flex items-center gap-2.5">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span className="font-medium">
                            <strong className="font-semibold text-amber-950">1 assessment still pending</strong> from Visit 5 (Fecal Calprotectin) — complete before Visit 6 on 05 Oct.
                        </span>
                    </div>
                    <button
                        onClick={() => { setActiveTab("Visits"); setSelectedVisitId("visit-5"); }}
                        className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline flex items-center gap-1 shrink-0 ml-4"
                    >
                        View visit &rarr;
                    </button>
                </div>
            </div>
            )}

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
                    <>
                        {/* SCENARIO A: SINGLE VISIT DETAIL VIEW (Matching Figma Image 3) */}
                        {selectedVisitId ? (
                            <div className="space-y-5">
                                {/* Back to visits breadcrumb */}
                                <button
                                    onClick={() => setSelectedVisitId(null)}
                                    className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
                                >
                                    <ArrowLeft className="h-4 w-4" /> Back to visits
                                </button>

                                {/* Sub-header Banner Card for Selected Visit */}
                                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <h2 className="text-xl font-bold text-gray-950">
                                                    {selectedVisitObj?.id === "visit-5" ? "Visit 5 — Week 8" : selectedVisitObj?.code}
                                                </h2>
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                                    selectedVisitObj?.status === "completed"
                                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                                        : selectedVisitObj?.status === "pending"
                                                            ? "bg-amber-50 text-amber-800 border border-amber-200 font-bold"
                                                            : "bg-blue-50 text-blue-700 border border-blue-200"
                                                }`}>
                                                    {selectedVisitObj?.statusLabel === "1 test pending" ? "In progress · 1 pending" : selectedVisitObj?.statusLabel}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 font-medium mt-1">
                                                20 Sep 2026, 09:30 · Main Clinical Site · Window &plusmn;3d (in window) · CRC: S. Patel
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setIsScheduleVisitDialogOpen(true)}
                                                className="border-gray-200 text-xs font-semibold text-gray-700 h-9"
                                            >
                                                Reschedule
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => toast.success("Visit reminder sent to patient!")}
                                                className="border-gray-200 text-xs font-semibold text-gray-700 h-9"
                                            >
                                                Send reminder
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => {
                                                    setIsCalprotectinDone(true);
                                                    setIsVisit5Complete(true);
                                                    toast.success("Visit marked as completed!");
                                                }}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-9 px-4 shadow-sm"
                                            >
                                                Mark visit complete
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* 2-Column Grid (Assessments Left, Prep & Notes Right) */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                                    {/* Left Column (2/3): Assessments List */}
                                    <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                                        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                                            <div>
                                                <h3 className="text-base font-bold text-gray-950">Assessments</h3>
                                                <p className="text-xs text-gray-400 font-medium mt-0.5">
                                                    {isCalprotectinDone || isVisit5Complete ? "14 of 14 complete" : "13 of 14 complete"}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setIsCalprotectinDone(true);
                                                    setIsVisit5Complete(true);
                                                    toast.success("All assessments marked as done!");
                                                }}
                                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                                            >
                                                Mark all done
                                            </button>
                                        </div>

                                        {/* Overall Progress Bar */}
                                        <div className="mt-4 mb-6">
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                                    style={{ width: isCalprotectinDone || isVisit5Complete ? "100%" : "92%" }}
                                                />
                                            </div>
                                        </div>

                                        {/* Assessment Groups */}
                                        <div className="space-y-6">
                                            {/* EXAMINATIONS */}
                                            <div>
                                                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                    EXAMINATIONS
                                                </h4>
                                                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                                                    {[
                                                        "Physical Examination",
                                                        "Vital Signs",
                                                        "Weight & Height",
                                                    ].map((item, idx) => (
                                                        <div key={idx} className="px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50/50">
                                                            <div className="flex items-center gap-2.5">
                                                                <span className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                                                    <Check className="h-3 w-3" />
                                                                </span>
                                                                <span className="text-xs font-semibold text-gray-900">{item}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                                    Done
                                                                </span>
                                                                <button
                                                                    onClick={() => toast.info(`Viewing ${item} record`)}
                                                                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                                >
                                                                    View
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* LABORATORY */}
                                            <div>
                                                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                    LABORATORY
                                                </h4>
                                                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                                                    {[
                                                        { name: "Hematology", status: "Done" },
                                                        { name: "Serum Chemistry", status: "Done" },
                                                        { name: "C-Reactive Protein (CRP)", status: "Done" },
                                                        { name: "Fecal Calprotectin", status: (isCalprotectinDone || isVisit5Complete) ? "Done" : "Pending" },
                                                    ].map((item, idx) => {
                                                        const isDone = item.status === "Done";
                                                        return (
                                                            <div key={idx} className={`px-4 py-3 flex items-center justify-between ${!isDone ? "bg-amber-50/30" : "bg-white"} hover:bg-gray-50/50`}>
                                                                <div className="flex items-center gap-2.5">
                                                                    <span className={`h-5 w-5 rounded-full ${isDone ? "bg-emerald-100 text-emerald-700" : "border-2 border-amber-400 bg-white"} flex items-center justify-center`}>
                                                                        {isDone && <Check className="h-3 w-3" />}
                                                                    </span>
                                                                    <span className="text-xs font-semibold text-gray-900">{item.name}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                                                        isDone
                                                                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                                                            : "bg-amber-100 text-amber-800 border border-amber-200"
                                                                    }`}>
                                                                        {item.status}
                                                                    </span>
                                                                    {isDone ? (
                                                                        <button
                                                                            onClick={() => toast.info(`Viewing ${item.name} record (${fecalCalprotectinValue})`)}
                                                                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                                        >
                                                                            View
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => setIsEnterResultDialogOpen(true)}
                                                                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                                                                        >
                                                                            Enter result
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* DISEASE ACTIVITY */}
                                            <div>
                                                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                    DISEASE ACTIVITY
                                                </h4>
                                                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                                                    {[
                                                        "Endoscopy + Mayo Score",
                                                        "Partial Mayo Score",
                                                        "IBDQ Questionnaire",
                                                    ].map((item, idx) => (
                                                        <div key={idx} className="px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50/50">
                                                            <div className="flex items-center gap-2.5">
                                                                <span className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                                                    <Check className="h-3 w-3" />
                                                                </span>
                                                                <span className="text-xs font-semibold text-gray-900">{item}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                                    Done
                                                                </span>
                                                                <button
                                                                    onClick={() => toast.info(`Viewing ${item} record`)}
                                                                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                                >
                                                                    View
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* SAFETY */}
                                            <div>
                                                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                    SAFETY
                                                </h4>
                                                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                                                    <div className="px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50/50">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                                                <Check className="h-3 w-3" />
                                                            </span>
                                                            <span className="text-xs font-semibold text-gray-900">Adverse Events</span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                                Done
                                                            </span>
                                                            <button
                                                                onClick={() => toast.info("Viewing Adverse Events log")}
                                                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                            >
                                                                View
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Column (1/3): Prep & Adherence + Visit Notes */}
                                    <div className="space-y-5">
                                        {/* Patient Prep & Adherence */}
                                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                            <h3 className="text-xs font-bold text-gray-950 mb-3">Patient prep &amp; adherence</h3>
                                            <div className="space-y-2.5 text-xs font-medium">
                                                <div className="flex items-center gap-2 text-gray-700">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                                                    <span>Bowel prep instructions sent (14 Sep)</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-gray-700">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                                                    <span>Fasting confirmed by patient</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-gray-700">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                                                    <span>Medication hold instructed</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-amber-800 font-semibold bg-amber-50/60 px-2 py-1 rounded border border-amber-100/60">
                                                    <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                                                    <span>Study drug diary — 2 entries missed</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Visit Notes */}
                                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                                            <h3 className="text-xs font-bold text-gray-950 mb-2">Visit notes</h3>
                                            <Textarea
                                                value={visitNoteText}
                                                onChange={(e) => setVisitNoteText(e.target.value)}
                                                className="text-xs border-gray-200 rounded-lg min-h-[90px] focus:ring-1 focus:ring-indigo-500"
                                            />
                                            <div className="mt-3 flex justify-end">
                                                <Button
                                                    size="sm"
                                                    onClick={() => toast.success("Visit notes saved successfully!")}
                                                    className="bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold h-8 px-3 rounded-lg border border-gray-200"
                                                >
                                                    Save note
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* SCENARIO B: FULL 13 VISITS LIST (Matching Figma Image 2) */
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                {/* Top Header Strip with Stats & Add Button */}
                                <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-600">
                                        <span className="px-2.5 py-1 rounded-full bg-gray-100 font-bold text-gray-800">
                                            13 visits total
                                        </span>
                                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                                            {completedVisits} completed
                                        </span>
                                        <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-bold">
                                            {isCalprotectinDone || isVisit5Complete ? "0 pending" : "1 pending"}
                                        </span>
                                        <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-semibold">
                                            7 upcoming
                                        </span>
                                        <span className="text-gray-300">·</span>
                                        <span className="text-gray-400">Generated from Visit Template v1.1</span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setIsScheduleVisitDialogOpen(true)}
                                        className="border-gray-200 text-xs font-semibold text-gray-700 h-8 px-3 rounded-lg shrink-0"
                                    >
                                        + Add unscheduled visit
                                    </Button>
                                </div>

                                {/* Visits Rows (Screening to Visit 12) */}
                                <div className="divide-y divide-gray-100">
                                    {protocolVisits.map((v) => (
                                        <div
                                            key={v.id}
                                            className={`px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50/80 transition-colors ${
                                                v.status === "next" ? "bg-blue-50/20" : ""
                                            }`}
                                        >
                                            {/* Left: Code & Date */}
                                            <div className="min-w-[200px]">
                                                <div className="flex items-center gap-2">
                                                    <span className={`h-2 w-2 rounded-full shrink-0 ${
                                                        v.status === "completed" ? "bg-emerald-500"
                                                        : v.status === "pending" ? "bg-amber-500"
                                                        : v.status === "next" ? "bg-blue-500"
                                                        : "bg-gray-300"
                                                    }`} />
                                                    <span className="text-sm font-bold text-gray-950">{v.code}</span>
                                                </div>
                                                <p className="text-xs text-gray-400 font-medium ml-4 mt-0.5">{v.targetDate}</p>
                                            </div>

                                            {/* Status Badge */}
                                            <div className="min-w-[130px]">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                                    v.status === "completed"
                                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                                        : v.status === "pending"
                                                            ? "bg-amber-50 text-amber-800 border border-amber-200 font-bold"
                                                            : v.status === "next"
                                                                ? "bg-blue-50 text-blue-700 border border-blue-200 font-bold"
                                                                : "bg-gray-100 text-gray-600"
                                                }`}>
                                                    {v.statusLabel}
                                                </span>
                                            </div>

                                            {/* Tests Progress Bar or Summary */}
                                            <div className="flex-1 max-w-xs">
                                                {v.totalTests > 0 && v.summary === undefined ? (
                                                    <div>
                                                        <p className="text-xs font-semibold text-gray-700 mb-1">
                                                            {v.testsCompleted} / {v.totalTests} tests done
                                                        </p>
                                                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full ${
                                                                    v.status === "completed"
                                                                        ? "bg-emerald-500"
                                                                        : v.status === "pending"
                                                                            ? "bg-amber-600"
                                                                            : "bg-blue-500"
                                                                }`}
                                                                style={{ width: `${v.progressPct}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-gray-400 font-medium">{v.summary}</p>
                                                )}
                                            </div>

                                            {/* Action Buttons (Matching Figma Screen 2 exact buttons!) */}
                                            <div className="flex items-center gap-2.5 shrink-0 justify-end">
                                                {v.secondaryLabel && (
                                                    <button
                                                        onClick={() => setIsScheduleVisitDialogOpen(true)}
                                                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded"
                                                    >
                                                        {v.secondaryLabel}
                                                    </button>
                                                )}
                                                {v.actionLabel && (
                                                    <button
                                                        onClick={() => setSelectedVisitId(v.id)}
                                                        className={`text-xs font-bold px-3 py-1 rounded transition-colors ${
                                                            v.actionType === "complete" || v.actionType === "open"
                                                                ? "text-indigo-700 hover:bg-indigo-50 font-extrabold"
                                                                : "text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50"
                                                        }`}
                                                    >
                                                        {v.actionLabel}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* COSTS TAB (PT - 4 Patient Financials) */}
                {activeTab === "Costs" && (
                    <div className="space-y-5">
                        {/* 4 Summary Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Reimbursed</p>
                                <p className="text-xl font-extrabold text-gray-950">$3,450.00</p>
                                <div className="mt-2.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: "84%" }} />
                                </div>
                                <p className="text-[11px] text-gray-400 mt-1 font-medium">84% of $4,100 protocol budget</p>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pending Claims</p>
                                <p className="text-xl font-extrabold text-amber-900">$620.00</p>
                                <p className="text-[11px] text-amber-700 mt-3 font-semibold">2 claims awaiting review</p>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Per-Visit Stipend</p>
                                <p className="text-xl font-extrabold text-gray-950">$150.00 / visit</p>
                                <p className="text-[11px] text-gray-400 mt-3 font-medium">Standard IRB Approved Rate</p>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Travel Allowance</p>
                                <p className="text-xl font-extrabold text-indigo-900">$45.00 / visit</p>
                                <p className="text-[11px] text-gray-400 mt-3 font-medium">Mileage &amp; Rideshare Comp</p>
                            </div>
                        </div>

                        {/* Financial Ledger Table */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <h3 className="text-base font-bold text-gray-950">Patient Financial Ledger</h3>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">Itemized list of visit stipends, lab procedures, and travel reimbursements</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toast.success("Exporting Financial Ledger PDF...")}
                                        className="border-gray-200 text-xs font-semibold text-gray-700 h-8 px-3 rounded-lg"
                                    >
                                        Export Statement
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={() => toast.info("New Expense Claim form opened")}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-8 px-3 rounded-lg"
                                    >
                                        + Log Expense Claim
                                    </Button>
                                </div>
                            </div>

                            <div className="divide-y divide-gray-100">
                                {[
                                    { visit: "Visit 1 · Screening", date: "29 Aug 2026", desc: "Lab panel, ECG, Participant Stipend", amount: "$450.00", status: "Paid", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { visit: "Visit 2 · Baseline", date: "12 Sep 2026", desc: "Cycle 1 Dose, Endoscopy, Travel Comp, Stipend", amount: "$820.00", status: "Paid", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { visit: "Visit 3 · Week 2", date: "26 Sep 2026", desc: "Follow-up blood draw, Stipend", amount: "$350.00", status: "Paid", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { visit: "Visit 4 · Week 4", date: "20 Sep 2026", desc: "IBDQ assessment, Lab chemistry, Stipend", amount: "$650.00", status: "Paid", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { visit: "Visit 5 · Week 8", date: "20 Sep 2026", desc: "Stool Calprotectin, Stipend, Travel claim", amount: "$620.00", status: "Pending Review", statusStyle: "bg-amber-50 text-amber-800 border-amber-200 font-bold", action: "Approve Claim" },
                                    { visit: "Visit 6 · Week 12", date: "05 Oct 2026", desc: "Upcoming visit allocation", amount: "$450.00", status: "Scheduled", statusStyle: "bg-gray-100 text-gray-600 border-gray-200" },
                                ].map((row, idx) => (
                                    <div key={idx} className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50/50 transition-colors">
                                        <div className="min-w-[200px]">
                                            <p className="text-xs font-bold text-gray-950">{row.visit}</p>
                                            <p className="text-[11px] text-gray-400 font-medium">{row.date}</p>
                                        </div>
                                        <div className="flex-1 text-xs text-gray-600 font-medium">
                                            {row.desc}
                                        </div>
                                        <div className="text-xs font-mono font-extrabold text-gray-900 min-w-[90px]">
                                            {row.amount}
                                        </div>
                                        <div className="min-w-[120px]">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${row.statusStyle}`}>
                                                {row.status}
                                            </span>
                                        </div>
                                        {row.action && (
                                            <button
                                                onClick={() => toast.success("Expense claim approved for payment!")}
                                                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                                            >
                                                {row.action}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* MEDICAL TAB (PT - 5 Medical History & Lab Records) */}
                {activeTab === "Medical" && (
                    <div className="space-y-5">
                        {/* 4 Health Indicator Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Blood Pressure</p>
                                <p className="text-xl font-extrabold text-gray-950">120 / 78 <span className="text-xs font-normal text-gray-400">mmHg</span></p>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 mt-2">Normal</span>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Heart Rate</p>
                                <p className="text-xl font-extrabold text-gray-950">72 <span className="text-xs font-normal text-gray-400">bpm</span></p>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 mt-2">Normal Resting</span>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Patient Weight</p>
                                <p className="text-xl font-extrabold text-gray-950">74.2 <span className="text-xs font-normal text-gray-400">kg</span></p>
                                <p className="text-[11px] text-gray-400 mt-2 font-medium">-0.8 kg from baseline (75.0 kg)</p>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-4">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Fecal Calprotectin</p>
                                <p className="text-xl font-extrabold text-indigo-900">145 <span className="text-xs font-normal text-gray-400">µg/g</span></p>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 mt-2">65% reduction from baseline</span>
                            </div>
                        </div>

                        {/* Medical Records Table & Filters */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-bold text-gray-950">Clinical Laboratory &amp; Diagnostic Records</h3>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">Comprehensive lab measurements, disease activity scores, and medication history</p>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={() => toast.info("Add Lab Result dialog opened")}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-8 px-3 rounded-lg shrink-0"
                                >
                                    + Log Lab Result
                                </Button>
                            </div>

                            {/* Category Filter Pills */}
                            <div className="px-6 py-3 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2 text-xs font-medium overflow-x-auto">
                                {[
                                    { id: "all", label: "All Records (12)" },
                                    { id: "hematology", label: "Hematology" },
                                    { id: "chemistry", label: "Serum Chemistry" },
                                    { id: "disease", label: "Disease Activity (Mayo)" },
                                    { id: "meds", label: "Concomitant Meds" },
                                ].map((f) => (
                                    <button
                                        key={f.id}
                                        onClick={() => setMedicalFilter(f.id)}
                                        className={`px-3 py-1 rounded-full border transition-colors ${
                                            medicalFilter === f.id
                                                ? "bg-indigo-600 text-white border-indigo-600 font-semibold"
                                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
                                        }`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>

                            {/* Lab Records Table */}
                            <div className="divide-y divide-gray-100 text-xs">
                                {[
                                    { cat: "Hematology", test: "Hemoglobin", value: "14.2 g/dL", refRange: "13.5 - 17.5 g/dL", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Hematology", test: "White Blood Cells (WBC)", value: "6.8 x10^3 / µL", refRange: "4.5 - 11.0 x10^3", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Hematology", test: "Platelet Count", value: "240 x10^3 / µL", refRange: "150 - 450 x10^3", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Serum Chemistry", test: "Alanine Aminotransferase (ALT)", value: "22 U/L", refRange: "7 - 56 U/L", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Serum Chemistry", test: "Aspartate Transferase (AST)", value: "19 U/L", refRange: "10 - 40 U/L", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Serum Chemistry", test: "Serum Creatinine", value: "0.9 mg/dL", refRange: "0.7 - 1.3 mg/dL", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Serum Chemistry", test: "C-Reactive Protein (CRP)", value: "2.1 mg/L", refRange: "< 3.0 mg/L", date: "20 Sep 2026", visit: "Visit 5", status: "Normal" },
                                    { cat: "Disease Activity", test: "Endoscopy Mayo Score", value: "1 (Mild Disease)", refRange: "0 - 3 scale", date: "12 Sep 2026", visit: "Baseline", status: "Improved" },
                                    { cat: "Disease Activity", test: "Partial Mayo Score", value: "2 (Mild)", refRange: "0 - 9 scale", date: "20 Sep 2026", visit: "Visit 5", status: "Improved" },
                                    { cat: "Disease Activity", test: "IBDQ Questionnaire Score", value: "185 points", refRange: "32 - 224 scale", date: "20 Sep 2026", visit: "Visit 5", status: "Optimal" },
                                    { cat: "Concomitant Meds", test: "Mesalamine (Oral)", value: "2.4 g / day", refRange: "Maintenance dose", date: "Active", visit: "Ongoing", status: "Active" },
                                    { cat: "Concomitant Meds", test: "Prednisone Taper", value: "10 mg / day", refRange: "Tapering schedule", date: "Active", visit: "Ongoing", status: "Active" },
                                ].filter(r => medicalFilter === "all" || r.cat.toLowerCase().includes(medicalFilter)).map((row, idx) => (
                                    <div key={idx} className="px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50/50 font-medium">
                                        <div className="min-w-[160px]">
                                            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">{row.cat}</span>
                                            <span className="font-bold text-gray-950">{row.test}</span>
                                        </div>
                                        <div className="font-mono font-extrabold text-gray-900 min-w-[140px]">
                                            {row.value}
                                        </div>
                                        <div className="text-gray-400 text-[11px] min-w-[130px]">
                                            Ref: {row.refRange}
                                        </div>
                                        <div className="text-gray-500 text-[11px] min-w-[110px]">
                                            {row.visit} · {row.date}
                                        </div>
                                        <div>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                {row.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* DOCUMENTS TAB (PT - 6 eConsent & Patient Docs) */}
                {activeTab === "Documents" && (
                    <div className="space-y-5">
                        {/* Status Header Strip */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className="h-10 w-10 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold">
                                    ✓
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-gray-950 flex items-center gap-2">
                                        Informed Consent Form (eICF v2.1)
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            Fully Signed &amp; Executed
                                        </span>
                                    </h3>
                                    <p className="text-xs text-gray-500 font-medium mt-0.5">
                                        Signed by John Doe on 20 Sep 2026, 14:15 · Witnessed by Principal Investigator Dr. S. Connor
                                    </p>
                                </div>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => toast.info("Opening document upload dialog...")}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-9 px-4 rounded-lg shrink-0"
                            >
                                + Upload Document
                            </Button>
                        </div>

                        {/* Document List Table */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                                <h3 className="text-base font-bold text-gray-950">Patient Document Repository (6 files)</h3>
                                <span className="text-xs text-gray-400 font-mono">Total Size: 14.2 MB</span>
                            </div>

                            <div className="divide-y divide-gray-100 text-xs">
                                {[
                                    { title: "Informed Consent Form (ICF v2.1)", type: "eConsent PDF", date: "20 Sep 2026", size: "2.4 MB", status: "Verified & Executed", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { title: "Patient Photo ID & Insurance Card", type: "Identity Document", date: "20 Sep 2026", size: "1.1 MB", status: "Verified", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { title: "Baseline Endoscopy Report", type: "Clinical Imaging PDF", date: "12 Sep 2026", size: "6.8 MB", status: "Verified", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { title: "Screening Blood Chemistry Export", type: "Lab Certificate", date: "29 Aug 2026", size: "840 KB", status: "Verified", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { title: "Patient Stool Diary Log (Weeks 1 - 8)", type: "Patient Log", date: "20 Sep 2026", size: "310 KB", status: "Verified", statusStyle: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                                    { title: "Genetic Biomarker Consent Addendum", type: "Consent Addendum", date: "Pending", size: "—", status: "Pending Signature", statusStyle: "bg-amber-50 text-amber-800 border-amber-200 font-bold", action: "Send eSign Request" },
                                ].map((doc, idx) => (
                                    <div key={idx} className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50/50 font-medium">
                                        <div className="min-w-[240px]">
                                            <p className="font-bold text-gray-950 text-xs">{doc.title}</p>
                                            <p className="text-[11px] text-gray-400">{doc.type} · {doc.size}</p>
                                        </div>
                                        <div className="text-gray-500 text-[11px] min-w-[100px]">
                                            {doc.date}
                                        </div>
                                        <div className="min-w-[130px]">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${doc.statusStyle}`}>
                                                {doc.status}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            {doc.action ? (
                                                <button
                                                    onClick={() => toast.success("eSign request sent to patient app & email!")}
                                                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                                                >
                                                    {doc.action}
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => toast.info(`Viewing ${doc.title}`)}
                                                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                    >
                                                        View
                                                    </button>
                                                    <button
                                                        onClick={() => toast.success(`Downloading ${doc.title}`)}
                                                        className="text-xs font-semibold text-gray-500 hover:text-gray-900"
                                                    >
                                                        Download
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* MESSAGING TAB (PT - 7 Patient Messaging Hub) */}
                {activeTab === "Messaging" && (
                    <div className="space-y-5">
                        {/* Compose Message Bar */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                            <h3 className="text-sm font-bold text-gray-950 mb-3 flex items-center gap-2">
                                <MessageCircle className="h-4 w-4 text-indigo-600" />
                                Send Message
                            </h3>
                            <div className="flex gap-3">
                                <Textarea
                                    placeholder="Type a message to the patient or care team..."
                                    className="text-xs border-gray-200 rounded-lg min-h-[70px] flex-1 focus:ring-1 focus:ring-indigo-500"
                                />
                                <div className="flex flex-col gap-2 shrink-0">
                                    <Button
                                        size="sm"
                                        onClick={() => toast.success("Message sent to patient via SMS & App!")}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-9 px-4 rounded-lg"
                                    >
                                        Send to Patient
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toast.success("Message sent to coordinator!")}
                                        className="border-gray-200 text-gray-700 text-xs font-semibold h-9 px-4 rounded-lg"
                                    >
                                        Send to Team
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Message Thread */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <h3 className="text-base font-bold text-gray-950">Message History</h3>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">All communications with {patient.patient_first_name} {patient.patient_last_name} and the study team</p>
                                </div>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    5 messages
                                </span>
                            </div>

                            <div className="divide-y divide-gray-100">
                                {[
                                    { from: "System", role: "Automated Alert", time: "05 Oct 2026, 08:00", msg: "Visit 6 reminder sent to patient: Upcoming visit on 05 Oct at 09:00. Please fast from midnight and bring your stool diary.", type: "alert" },
                                    { from: patient.patient_first_name + " " + patient.patient_last_name, role: "Patient", time: "03 Oct 2026, 17:32", msg: "Hi, just wanted to confirm my appointment for Thursday. Do I need to bring anything special?", type: "patient" },
                                    { from: "Dr. S. Connor", role: "Principal Investigator", time: "03 Oct 2026, 18:10", msg: "Yes, please bring your study diary and remember to fast from midnight on Wednesday. The bowel prep instructions were already sent to your app.", type: "team" },
                                    { from: "S. Patel", role: "Clinical Research Coordinator", time: "29 Sep 2026, 11:00", msg: "Calprotectin sample from Visit 5 has been received by the lab. Results expected within 48–72 hours.", type: "team" },
                                    { from: "System", role: "Automated Reminder", time: "14 Sep 2026, 09:00", msg: "Bowel prep instructions sent to patient for Visit 5. Study drug diary reminder also sent.", type: "alert" },
                                ].map((msg, idx) => (
                                    <div key={idx} className={`px-6 py-4 flex items-start gap-4 hover:bg-gray-50/50 transition-colors ${msg.type === "patient" ? "bg-indigo-50/20" : ""}`}>
                                        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                                            msg.type === "alert" ? "bg-amber-100 text-amber-700"
                                            : msg.type === "patient" ? "bg-indigo-100 text-indigo-700"
                                            : "bg-gray-100 text-gray-700"
                                        }`}>
                                            {msg.type === "alert" ? "⚡" : msg.from[0]}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className="text-xs font-bold text-gray-950">{msg.from}</span>
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                    msg.type === "alert" ? "bg-amber-50 text-amber-700 border border-amber-100"
                                                    : msg.type === "patient" ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                                                    : "bg-gray-100 text-gray-600 border border-gray-200"
                                                }`}>
                                                    {msg.role}
                                                </span>
                                                <span className="text-[11px] text-gray-400 font-medium ml-auto">{msg.time}</span>
                                            </div>
                                            <p className="text-xs text-gray-700 font-medium leading-relaxed">{msg.msg}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* SAFETY & AEs TAB (PT - 8 Adverse Events & Safety) */}
                {activeTab === "Safety & AEs" && (
                    <div className="space-y-5">
                        {/* Safety Summary KPI Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Adverse Events</p>
                                <p className="text-2xl font-extrabold text-gray-950">1 <span className="text-xs font-normal text-gray-400">(Grade 1 Mild)</span></p>
                                <p className="text-xs text-gray-400 mt-2 font-medium">Mild fatigue reported during Week 2</p>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Serious AEs (SAE)</p>
                                <p className="text-2xl font-extrabold text-emerald-700">0</p>
                                <p className="text-xs text-emerald-600 mt-2 font-semibold">Zero serious adverse events logged</p>
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm p-5">
                                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Protocol Deviations</p>
                                <p className="text-2xl font-extrabold text-emerald-700">0</p>
                                <p className="text-xs text-emerald-600 mt-2 font-semibold">100% protocol adherence</p>
                            </div>
                        </div>

                        {/* Adverse Events Log Table */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <h3 className="text-base font-bold text-gray-950">Adverse Event Safety Registry</h3>
                                    <p className="text-xs text-gray-400 font-medium mt-0.5">Recorded safety events, severity grading, and causality assessments</p>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={() => toast.info("Report AE dialog opened")}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold h-8 px-3 rounded-lg"
                                >
                                    + Report Adverse Event
                                </Button>
                            </div>

                            <div className="divide-y divide-gray-100 text-xs font-medium">
                                <div className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-gray-50/50">
                                    <div className="min-w-[180px]">
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">AE #001 · Mild</span>
                                        <span className="font-bold text-gray-950 text-sm">Fatigue / Asthenia</span>
                                    </div>
                                    <div className="text-gray-600 text-xs min-w-[140px]">
                                        Severity: <span className="font-bold text-amber-800">Grade 1 (Mild)</span>
                                    </div>
                                    <div className="text-gray-600 text-xs min-w-[160px]">
                                        Causality: <span className="font-semibold text-gray-800">Possibly Related (Arm A)</span>
                                    </div>
                                    <div className="text-gray-500 text-[11px] min-w-[140px]">
                                        Onset: 14 Sep 2026<br />Resolved: 18 Sep 2026
                                    </div>
                                    <div>
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            Resolved
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Enter Result Dialog ──────────────────────────────────────── */}
            <Dialog open={isEnterResultDialogOpen} onOpenChange={setIsEnterResultDialogOpen}>
                <DialogContent className="sm:max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl">
                    <DialogHeader className="pb-3 border-b border-gray-100">
                        <DialogTitle className="text-base font-bold text-gray-950">Enter Fecal Calprotectin Result</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-3 text-xs">
                        <p className="text-gray-500 font-medium">
                            Enter the laboratory measurement value for Visit 5 (Week 8) stool analysis.
                        </p>
                        <div className="space-y-1.5">
                            <label className="font-semibold text-gray-900">Lab Value (µg/g)</label>
                            <Input
                                value={fecalCalprotectinValue}
                                onChange={(e) => setFecalCalprotectinValue(e.target.value)}
                                className="rounded-lg border-gray-200 text-xs font-mono"
                                placeholder="e.g. 145 µg/g"
                            />
                        </div>
                        <div className="flex justify-end gap-2.5 pt-3 border-t border-gray-100">
                            <Button
                                variant="outline"
                                onClick={() => setIsEnterResultDialogOpen(false)}
                                className="border-gray-200 text-gray-700 text-xs rounded-lg"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={() => {
                                    setIsCalprotectinDone(true);
                                    setIsEnterResultDialogOpen(false);
                                    toast.success(`Fecal Calprotectin result (${fecalCalprotectinValue}) saved!`);
                                }}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg font-semibold"
                            >
                                Save &amp; Mark Done
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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
