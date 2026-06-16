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
  FileText,
  Bookmark,
  CalendarDays,
  FileCheck,
  ClipboardList
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

export default function PatientDetail({ trialId, patientId }: PatientDetailProps) {
  const [, navigate] = useLocation();
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();

  // Dialog state for visit scheduling
  const [isScheduleVisitDialogOpen, setIsScheduleVisitDialogOpen] = useState(false);
  const [visitForm, setVisitForm] = useState({
    visitDate: new Date().toISOString().split("T")[0],
    visitTime: "09:00",
    visitType: "follow_up",
    notes: "",
    location: "Main Clinic",
  });

  // Queries
  const patientsQuery = trpc.patients.listByTrial.useQuery(
    { trialId },
    { enabled: Boolean(trialId) }
  );

  const visitsQuery = trpc.patients.listVisits.useQuery(
    { patientId, trialId },
    { enabled: Boolean(patientId && trialId) }
  );

  // Mutation
  const createVisitMutation = trpc.patients.createVisit.useMutation({
    onSuccess: () => {
      toast.success("Visit successfully scheduled!");
      setIsScheduleVisitDialogOpen(false);
      // Reset form
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

  // Memoized data selector
  const patient = useMemo(() => {
    if (!patientsQuery.data) return null;
    return patientsQuery.data.find((p) => p.patient_id === patientId) || null;
  }, [patientsQuery.data, patientId]);

  // Statistics calculations
  const stats = useMemo(() => {
    const visits = visitsQuery.data || [];
    const scheduled = visits.filter((v) => v.status === "scheduled").length;
    const completed = visits.filter((v) => v.status === "completed" || v.status === "done").length;
    return {
      total: visits.length,
      scheduled,
      completed,
    };
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

  if (patientsQuery.isLoading || visitsQuery.isLoading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
        <p className="text-gray-500 font-medium text-sm">Loading patient profile dashboard...</p>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="py-24 text-center">
        <User className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-gray-900">Patient Profile Not Found</h3>
        <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">
          The requested clinical trial participant does not exist or has been unenrolled from this study.
        </p>
        <Button
          onClick={() => navigate(`/trial/${trialId}?tab=patients`)}
          className="mt-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center gap-1.5 mx-auto shadow-sm transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Study Cohort
        </Button>
      </div>
    );
  }

  const initials = `${patient.patient_first_name?.[0] || ""}${patient.patient_last_name?.[0] || ""}`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-300">
      {/* Header and Back Button */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(`/trial/${trialId}?tab=patients`)}
            className="border-gray-200 hover:bg-gray-50 hover:text-gray-900 rounded-xl"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                {patient.patient_code}
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200 capitalize">
                {patient.status}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-gray-950 mt-1">
              {patient.patient_first_name} {patient.patient_last_name}
            </h1>
          </div>
        </div>
        
        <Button
          onClick={() => setIsScheduleVisitDialogOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center gap-2 py-2 px-5 font-semibold text-sm shadow-sm transition-colors"
        >
          <Plus className="h-4 w-4" /> Schedule Visit
        </Button>
      </div>

      {/* Top Level Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="h-12 w-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Visits Logged</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.total}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="h-12 w-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Upcoming Scheduled</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.scheduled}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex items-center gap-4 hover:shadow-md transition-shadow">
          <div className="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <FileCheck className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Completed / Checked</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.completed}</p>
          </div>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column - Demographics Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div className="flex flex-col items-center text-center pb-6 border-b border-gray-100">
            <Avatar className="h-20 w-20 bg-indigo-600 rounded-full text-white font-bold text-2xl flex items-center justify-center shadow-inner">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <h3 className="font-bold text-gray-950 text-lg mt-4 leading-tight">
              {patient.patient_first_name} {patient.patient_last_name}
            </h3>
            <p className="text-xs font-mono text-indigo-600 mt-1">{patient.patient_code}</p>
            {patient.patient_data?.email && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 mt-3 hover:text-indigo-600 cursor-pointer">
                <Mail className="h-3.5 w-3.5" /> {patient.patient_data.email}
              </span>
            )}
            {patient.patient_data?.phone_number && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500 mt-1.5 hover:text-indigo-600 cursor-pointer">
                <Phone className="h-3.5 w-3.5" /> {patient.patient_data.phone_number}
              </span>
            )}
          </div>

          <div className="space-y-4 text-sm">
            <h4 className="font-semibold text-gray-900 text-xs uppercase tracking-wider">Participant Demographics</h4>
            
            <div className="grid grid-cols-2 gap-y-3.5 gap-x-2 text-xs">
              <div className="text-gray-400">Date of Birth</div>
              <div className="font-medium text-gray-900 text-right">
                {patient.patient_data?.date_of_birth
                  ? new Date(patient.patient_data.date_of_birth).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })
                  : "N/A"}
              </div>

              <div className="text-gray-400">Gender</div>
              <div className="font-medium text-gray-900 text-right capitalize">
                {patient.patient_data?.gender || "N/A"}
              </div>

              <div className="text-gray-400">Study Status</div>
              <div className="font-medium text-gray-900 text-right capitalize">
                {patient.status}
              </div>

              <div className="text-gray-400">Enrollment Date</div>
              <div className="font-medium text-gray-900 text-right">
                {patient.enrollment_date
                  ? new Date(patient.enrollment_date).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })
                  : "N/A"}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100 space-y-4 text-sm">
            <h4 className="font-semibold text-gray-900 text-xs uppercase tracking-wider">Consent & Validation</h4>
            
            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Informed Consent Status</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Signed
                </span>
              </div>

              {patient.patient_data?.consent_date && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Consent Date</span>
                  <span className="font-medium text-gray-900">
                    {new Date(patient.patient_data.consent_date).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })}
                  </span>
                </div>
              )}

              {patient.patient_data?.screening_notes && (
                <div className="pt-2">
                  <p className="text-gray-400 mb-1">Screening/Inclusion Notes</p>
                  <p className="text-gray-600 bg-gray-50 p-3 rounded-xl leading-relaxed border border-gray-100/50">
                    {patient.patient_data.screening_notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Clinical Visits History & Schedule */}
        <div className="lg:col-span-2 space-y-6">
          {/* Notes Section if any */}
          {patient.notes && (
            <div className="bg-indigo-50/30 border border-indigo-100 rounded-2xl p-6">
              <h4 className="text-sm font-semibold text-indigo-950 flex items-center gap-1.5 mb-2">
                <ClipboardList className="h-4.5 w-4.5 text-indigo-600" /> Coordinator Case Notes
              </h4>
              <p className="text-xs text-indigo-900 leading-relaxed font-medium bg-white p-3 rounded-xl border border-indigo-100/40">
                {patient.notes}
              </p>
            </div>
          )}

          {/* Visits Timeline Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-950">Clinical Visits Log</h3>
                <p className="text-xs text-gray-500 mt-0.5">Timeline of past checks and scheduled milestones.</p>
              </div>
              <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-1 rounded-lg">
                {visitsQuery.data?.length ?? 0} Milestones
              </span>
            </div>

            <div className="mt-6 relative border-l border-gray-100 pl-6 ml-3 space-y-8">
              {!visitsQuery.data || visitsQuery.data.length === 0 ? (
                <div className="py-20 text-center text-gray-400 flex flex-col items-center justify-center border-2 border-dashed border-gray-50 rounded-xl bg-gray-50/30 ml-[-24px]">
                  <Calendar className="h-10 w-10 text-gray-300 mb-3 animate-pulse" />
                  <p className="font-semibold text-gray-900 text-sm">No Visits Logged</p>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm">No clinical visits have been scheduled or completed for this patient yet.</p>
                </div>
              ) : (
                visitsQuery.data.map((visit) => {
                  const isScheduled = visit.status === "scheduled";
                  return (
                    <div key={visit.id} className="relative">
                      {/* Timeline Dot */}
                      <span className={`absolute top-1.5 left-[-31px] h-3 w-3 rounded-full border-2 bg-white flex items-center justify-center ${
                        isScheduled ? "border-indigo-600 ring-4 ring-indigo-50" : "border-emerald-600 ring-4 ring-emerald-50"
                      }`} />

                      <div className="p-4 border border-gray-100 hover:border-gray-200 rounded-2xl bg-gray-50/20 hover:bg-gray-50/40 transition-all text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-gray-100/50 pb-2 mb-3">
                          <span className={`font-semibold capitalize text-[10px] px-2 py-0.5 rounded-full border leading-normal w-max ${
                            visit.visit_type === "screening"
                              ? "bg-blue-50 text-blue-700 border-blue-100"
                              : visit.visit_type === "baseline"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                              : "bg-purple-50 text-purple-700 border-purple-100"
                          }`}>
                            {visit.visit_type.replace("_", " ")}
                          </span>

                          <div className="flex items-center gap-3 text-gray-400 font-mono text-[11px]">
                            <span className="flex items-center gap-1 text-gray-600 font-semibold">
                              <Calendar className="h-3.5 w-3.5 text-gray-400" />
                              {new Date(visit.visit_date).toLocaleDateString(undefined, {
                                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
                              })}
                            </span>
                            {visit.visit_time && (
                              <span className="flex items-center gap-0.5">
                                <Clock className="h-3.5 w-3.5" /> {visit.visit_time}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-gray-400 block mb-0.5">Assigned Practitioner</span>
                            <span className="font-semibold text-gray-950 flex items-center gap-1">
                              <User className="h-3.5 w-3.5 text-gray-400" /> {visit.doctor_name || "Assigned staff"}
                            </span>
                          </div>

                          {visit.location && (
                            <div>
                              <span className="text-gray-400 block mb-0.5">Visit Location</span>
                              <span className="font-medium text-gray-900 flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 text-gray-400" /> {visit.location}
                              </span>
                            </div>
                          )}
                        </div>

                        {visit.notes && (
                          <div className="text-xs text-gray-600 bg-white p-3 rounded-xl border border-gray-100 mt-3.5 leading-relaxed font-medium">
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1">Clinical Notes</span>
                            {visit.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Visit Dialog */}
      <Dialog open={isScheduleVisitDialogOpen} onOpenChange={setIsScheduleVisitDialogOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
          <DialogHeader className="pb-4 border-b border-gray-100 flex flex-row items-center justify-between">
            <DialogTitle className="text-lg font-bold text-gray-950">Schedule Patient Visit</DialogTitle>
            <button
              onClick={() => setIsScheduleVisitDialogOpen(false)}
              className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-4.5 w-4.5" />
            </button>
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
                  className="rounded-lg border-gray-200 text-xs py-2 px-3 focus:ring-indigo-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-gray-900">Visit Time</label>
                <Input
                  type="time"
                  required
                  value={visitForm.visitTime}
                  onChange={(e) => setVisitForm({ ...visitForm, visitTime: e.target.value })}
                  className="rounded-lg border-gray-200 text-xs py-2 px-3 focus:ring-indigo-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="font-semibold text-gray-900">Visit Type</label>
                <select
                  value={visitForm.visitType}
                  onChange={(e) => setVisitForm({ ...visitForm, visitType: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white text-xs py-2 px-3 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                >
                  <option value="screening">Screening</option>
                  <option value="baseline">Baseline</option>
                  <option value="treatment">Treatment</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="study_closeout">Study Closeout</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-gray-900">Location</label>
                <Input
                  type="text"
                  required
                  value={visitForm.location}
                  onChange={(e) => setVisitForm({ ...visitForm, location: e.target.value })}
                  className="rounded-lg border-gray-200 text-xs py-2 px-3 focus:ring-indigo-600"
                  placeholder="e.g. Room 402, Main Clinic"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-gray-900">Notes / Visit Instructions</label>
              <Textarea
                value={visitForm.notes}
                onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                className="rounded-lg border-gray-200 text-xs p-3 focus:ring-indigo-600 min-h-[100px]"
                placeholder="Include details about blood samples, specific drug infusions, or checklist instructions..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsScheduleVisitDialogOpen(false)}
                className="border-gray-200 hover:bg-gray-50 text-gray-700 py-2 px-4 text-xs font-semibold rounded-lg"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createVisitMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-5 text-xs font-semibold rounded-lg shadow-sm"
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
