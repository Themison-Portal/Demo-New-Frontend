/**
 * Demo State Context
 * Manages persistent interconnected state across all pages using localStorage
 * Survives page navigation and browser refresh, can be reset to initial state
 */

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { toast } from "sonner";

// Task status types
export type TaskStatus = "due_today" | "waiting_on_monitor" | "review_pending" | "need_answers" | "completed";

// Task interface
export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  completed: boolean;
  assignee?: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
}

// Document interface
export interface Document {
  id: string;
  name: string;
  type: string;
  uploadedBy: string;
  uploadedAt: string;
  size: string;
  reviewed: boolean;
}

// Trial milestone interface
export interface Milestone {
  id: string;
  name: string;
  progress: number;
  dueDate: string;
  status: "on_track" | "at_risk" | "completed";
}

// Team member interface
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  initials: string;
  clinicalRole?: string;
  appRole?: string;
  team?: string;
  site?: string;
  status?: string;
}

// Trial interface
export interface Trial {
  id: string;
  name: string;
  phase: string;
  status: 'active' | 'recruiting' | 'completed' | 'on-hold';
  sponsor: string;
  enrolled: number;
  target: number;
  color: string;
}

// Demo state interface
export interface DemoState {
  tasks: Task[];
  documents: Document[];
  milestones: Milestone[];
  teamMembers: TeamMember[];
  trials: Trial[];
  activeTrials: number;
  blockedTasks: number;
  dataMode: 'sample' | 'full' | 'building';
}

// Initial demo state
const initialDemoState: DemoState = {
  tasks: [
    {
      id: "task-1",
      name: "2 tasks",
      status: "due_today",
      completed: false,
    },
    {
      id: "task-2",
      name: "1 task blocked",
      status: "waiting_on_monitor",
      completed: false,
    },
    {
      id: "task-3",
      name: "Amendment v3 uploaded",
      status: "review_pending",
      completed: false,
    },
    {
      id: "task-4",
      name: "2 protocol questions",
      status: "need_answers",
      completed: false,
    },
  ],
  documents: [],
  milestones: [],
  teamMembers: [
    {
      id: "member-1",
      name: "Kaleb Sanders",
      email: "kaleb.s@themison.com",
      role: "Principal Investigator",
      clinicalRole: "Principal Investigator",
      appRole: "Superadmin",
      team: "Clinical",
      site: "Copenhagen",
      status: "Active",
      initials: "KS",
    },
    {
      id: "member-2",
      name: "Ava Patel",
      email: "ava.patel@themison.com",
      role: "Sub-Investigator",
      clinicalRole: "Sub-Investigator",
      appRole: "Admin",
      team: "Clinical",
      site: "Brussels",
      status: "Active",
      initials: "AP",
    },
    {
      id: "member-3",
      name: "Liam Chen",
      email: "liam.chen@themison.com",
      role: "Clinical Research Coordinator",
      clinicalRole: "CRC",
      appRole: "Editor",
      team: "Study Team",
      site: "Copenhagen",
      status: "Active",
      initials: "LC",
    },
    {
      id: "member-4",
      name: "Maya Rodriguez",
      email: "maya.rodriguez@themison.com",
      role: "Research Nurse",
      clinicalRole: "Nurse",
      appRole: "Editor",
      team: "Nursing",
      site: "Copenhagen",
      status: "Active",
      initials: "MR",
    },
    {
      id: "member-5",
      name: "Noah Brooks",
      email: "noah.brooks@themison.com",
      role: "Data Manager",
      clinicalRole: "Data Manager",
      appRole: "Editor",
      team: "Data",
      site: "Amsterdam",
      status: "Active",
      initials: "NB",
    },
    {
      id: "member-6",
      name: "Olivia Hart",
      email: "olivia.hart@themison.com",
      role: "Regulatory Specialist",
      clinicalRole: "Regulatory",
      appRole: "Admin",
      team: "Regulatory",
      site: "London",
      status: "Active",
      initials: "OH",
    },
    {
      id: "member-7",
      name: "Sofia Alvarez",
      email: "sofia.alvarez@themison.com",
      role: "Clinical Operations",
      clinicalRole: "CRC",
      appRole: "Editor",
      team: "Study Team",
      site: "Copenhagen",
      status: "Active",
      initials: "SA",
    },
    {
      id: "member-8",
      name: "Daniel Nguyen",
      email: "daniel.nguyen@themison.com",
      role: "Lab Lead",
      clinicalRole: "Lab",
      appRole: "Admin",
      team: "Lab",
      site: "Copenhagen",
      status: "Active",
      initials: "DN",
    },
    {
      id: "member-9",
      name: "Priya Nair",
      email: "priya.nair@themison.com",
      role: "Safety Lead",
      clinicalRole: "Safety",
      appRole: "Editor",
      team: "Safety",
      site: "London",
      status: "Active",
      initials: "PN",
    },
    {
      id: "member-10",
      name: "Lucas Meyer",
      email: "lucas.meyer@themison.com",
      role: "Site Manager",
      clinicalRole: "Site Manager",
      appRole: "Admin",
      team: "Operations",
      site: "Berlin",
      status: "Active",
      initials: "LM",
    },
    {
      id: "member-11",
      name: "Isabelle Laurent",
      email: "isabelle.laurent@themison.com",
      role: "Quality Lead",
      clinicalRole: "Quality",
      appRole: "Editor",
      team: "Quality",
      site: "Paris",
      status: "Active",
      initials: "IL",
    },
    {
      id: "member-12",
      name: "Jordan Reed",
      email: "jordan.reed@themison.com",
      role: "Regulatory",
      clinicalRole: "Regulatory",
      appRole: "Editor",
      team: "Regulatory",
      site: "Brussels",
      status: "Active",
      initials: "JR",
    },
    {
      id: "member-13",
      name: "Zara Malik",
      email: "zara.malik@themison.com",
      role: "Pharmacovigilance",
      clinicalRole: "Pharmacovigilance",
      appRole: "Editor",
      team: "Safety",
      site: "London",
      status: "Active",
      initials: "ZM",
    },
  ],
  trials: [
    {
      id: '1',
      name: 'Trial ABC-123',
      phase: 'Phase III',
      status: 'active',
      sponsor: 'Novo Nordisk',
      enrolled: 12,
      target: 50,
      color: '#3b82f6',
    },
    {
      id: '2',
      name: 'Trial DEF-456',
      phase: 'Phase II',
      status: 'recruiting',
      sponsor: 'Roche',
      enrolled: 8,
      target: 30,
      color: '#8b5cf6',
    },
    {
      id: '3',
      name: 'Trial GHI-789',
      phase: 'Phase III',
      status: 'active',
      sponsor: 'Pfizer',
      enrolled: 25,
      target: 100,
      color: '#10b981',
    },
    {
      id: '4',
      name: 'Trial JKL-012',
      phase: 'Phase I',
      status: 'recruiting',
      sponsor: 'Biogen',
      enrolled: 3,
      target: 15,
      color: '#f59e0b',
    },
    {
      id: '5',
      name: 'Trial MNO-345',
      phase: 'Phase II',
      status: 'active',
      sponsor: 'AstraZeneca',
      enrolled: 18,
      target: 60,
      color: '#ef4444',
    },
    {
      id: '6',
      name: 'Trial PQR-678',
      phase: 'Phase III',
      status: 'active',
      sponsor: 'Johnson & Johnson',
      enrolled: 45,
      target: 120,
      color: '#06b6d4',
    },
    {
      id: '7',
      name: 'Trial STU-901',
      phase: 'Phase II',
      status: 'recruiting',
      sponsor: 'Galderma',
      enrolled: 6,
      target: 25,
      color: '#ec4899',
    },
    {
      id: '8',
      name: 'Trial VWX-234',
      phase: 'Phase III',
      status: 'on-hold',
      sponsor: 'Takeda',
      enrolled: 32,
      target: 80,
      color: '#6366f1',
    },
  ],
  activeTrials: 12,
  blockedTasks: 4,
  dataMode: 'sample',
};

interface DemoStateContextType {
  state: DemoState;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  addDocument: (document: Document) => void;
  addTeamMember: (member: TeamMember) => void;
  updateTeamMember: (memberId: string, updates: Partial<TeamMember>) => void;
  updateMilestone: (milestoneId: string, updates: Partial<Milestone>) => void;
  resetDemo: () => void;
  loadSampleData: () => void;
  loadFullDataset: () => void;
  fullResetLocal: (modeOverride?: DemoState["dataMode"]) => void;
  setBuildingMode: () => void;
  getCompletedTasksCount: () => number;
  getActiveTasksCount: () => number;
  getCurrentDataMode: () => 'sample' | 'full' | 'building';
}

const DemoStateContext = createContext<DemoStateContextType | undefined>(undefined);

const STORAGE_KEY = "themison-demo-state";
const STORAGE_KEY_SAMPLE = `${STORAGE_KEY}-sample`;
const STORAGE_KEY_FULL = `${STORAGE_KEY}-full`;
const STORAGE_KEY_BUILDING = `${STORAGE_KEY}-building`;
const STORAGE_KEY_ACTIVE_MODE = `${STORAGE_KEY}-active-mode`;

const isDemoDataMode = (value: string | null): value is DemoState["dataMode"] => {
  return value === "sample" || value === "full" || value === "building";
};

const getStorageKeyForMode = (mode: DemoState["dataMode"]) => {
  switch (mode) {
    case "full":
      return STORAGE_KEY_FULL;
    case "building":
      return STORAGE_KEY_BUILDING;
    case "sample":
    default:
      return STORAGE_KEY_SAMPLE;
  }
};

const withMode = (state: DemoState, mode: DemoState["dataMode"]) => ({
  ...state,
  dataMode: mode,
});

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => {
    // Load active mode from localStorage on initial mount (sample mode by default)
    const storedModeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_MODE);
    const activeMode: DemoState["dataMode"] = isDemoDataMode(storedModeRaw) ? storedModeRaw : "sample";
    const stored = localStorage.getItem(getStorageKeyForMode(activeMode));
    if (stored) {
      try {
        return withMode(JSON.parse(stored), activeMode);
      } catch (e) {
        console.error("Failed to parse stored state:", e);
        return withMode(initialDemoState, "sample");
      }
    }
    return withMode(initialDemoState, "sample");
  });

  // Save to localStorage whenever state changes
  useEffect(() => {
    const key = getStorageKeyForMode(state.dataMode);
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem(STORAGE_KEY_ACTIVE_MODE, state.dataMode);
  }, [state]);

  useEffect(() => {
    toast.dismiss("demo-reset");
  }, [state.dataMode]);

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      ),
      dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
    }));
  };

  const addDocument = (document: Document) => {
    setState((prev) => ({
      ...prev,
      documents: [...prev.documents, document],
      dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
    }));
  };

  const addTeamMember = (member: TeamMember) => {
    setState((prev) => ({
      ...prev,
      teamMembers: [...prev.teamMembers, member],
      dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
    }));
  };

  const updateTeamMember = (memberId: string, updates: Partial<TeamMember>) => {
    setState((prev) => ({
      ...prev,
      teamMembers: prev.teamMembers.map((member) =>
        member.id === memberId ? { ...member, ...updates } : member
      ),
      dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
    }));
  };

  const updateMilestone = (milestoneId: string, updates: Partial<Milestone>) => {
    setState((prev) => ({
      ...prev,
      milestones: prev.milestones.map((milestone) =>
        milestone.id === milestoneId ? { ...milestone, ...updates } : milestone
      ),
      dataMode: prev.dataMode === 'building' ? 'building' : prev.dataMode,
    }));
  };

  const resetDemo = () => {
    const emptyState: DemoState = {
      tasks: [],
      documents: [],
      milestones: [],
      teamMembers: [
        {
          id: "member-1",
          name: "Kaleb Sanders",
          email: "kaleb.s@themison.com",
          role: "Principal Investigator",
          clinicalRole: "Principal Investigator",
          appRole: "Superadmin",
          team: "Clinical",
          site: "Copenhagen",
          status: "Active",
          initials: "KS",
        },
      ],
      trials: [],
      activeTrials: 0,
      blockedTasks: 0,
      dataMode: 'building',
    };
    const nextState = withMode(emptyState, "building");
    setState(nextState);
    localStorage.setItem(STORAGE_KEY_BUILDING, JSON.stringify(nextState));
  };

  const loadSampleData = () => {
    const stored = localStorage.getItem(STORAGE_KEY_SAMPLE);
    if (stored) {
      try {
        setState(withMode(JSON.parse(stored), "sample"));
        return;
      } catch (e) {
        console.error("Failed to parse stored sample state:", e);
      }
    }
    const nextState = withMode(initialDemoState, "sample");
    setState(nextState);
    localStorage.setItem(STORAGE_KEY_SAMPLE, JSON.stringify(nextState));
  };

  const buildFullDataset = (): DemoState => ({
    ...initialDemoState,
    activeTrials: 27,
    blockedTasks: 8,
    dataMode: 'full',
    tasks: [
      ...initialDemoState.tasks,
      { id: "task-5", name: "Site visit scheduled", status: "completed", completed: true },
      { id: "task-6", name: "IRB approval pending", status: "review_pending", completed: false },
      { id: "task-7", name: "Patient consent forms", status: "due_today", completed: false },
      { id: "task-8", name: "Data entry verification", status: "need_answers", completed: false },
    ],
    teamMembers: [
      ...initialDemoState.teamMembers,
      { id: "member-14", name: "Hannah Park", email: "hannah.park@themison.com", role: "Project Manager", clinicalRole: "Project Manager", appRole: "Admin", team: "Operations", site: "Brussels", status: "Active", initials: "HP" },
      { id: "member-15", name: "Marco Silva", email: "marco.silva@themison.com", role: "Clinical Operations", clinicalRole: "Clinical Ops", appRole: "Editor", team: "Clinical", site: "Lisbon", status: "Active", initials: "MS" },
      { id: "member-16", name: "Rina Sato", email: "rina.sato@themison.com", role: "eTMF Lead", clinicalRole: "eTMF", appRole: "Editor", team: "Regulatory", site: "Berlin", status: "Active", initials: "RS" },
      { id: "member-17", name: "Owen Price", email: "owen.price@themison.com", role: "Medical Monitor", clinicalRole: "Medical Monitor", appRole: "Admin", team: "Medical", site: "London", status: "Active", initials: "OP" },
      { id: "member-18", name: "Camila Duarte", email: "camila.duarte@themison.com", role: "Site Coordinator", clinicalRole: "CRC", appRole: "Editor", team: "Study Team", site: "Paris", status: "Active", initials: "CD" },
      { id: "member-19", name: "Isaac Walker", email: "isaac.walker@themison.com", role: "Principal Investigator", clinicalRole: "Principal Investigator", appRole: "Admin", team: "Clinical", site: "Copenhagen", status: "Active", initials: "IW" },
    ],
    trials: [
      ...initialDemoState.trials,
      { id: 'yza-567', name: 'Trial YZA-567', phase: 'Phase II', status: 'active', sponsor: 'Merck', enrolled: 15, target: 45, color: '#14b8a6' },
      { id: 'bcd-890', name: 'Trial BCD-890', phase: 'Phase III', status: 'recruiting', sponsor: 'Sanofi', enrolled: 22, target: 75, color: '#f97316' },
      { id: 'efg-123', name: 'Trial EFG-123', phase: 'Phase I', status: 'active', sponsor: 'Gilead', enrolled: 5, target: 20, color: '#a855f7' },
      { id: 'hij-456', name: 'Trial HIJ-456', phase: 'Phase II', status: 'recruiting', sponsor: 'Amgen', enrolled: 18, target: 55, color: '#22c55e' },
      { id: 'klm-789', name: 'Trial KLM-789', phase: 'Phase III', status: 'active', sponsor: 'Bristol Myers', enrolled: 40, target: 110, color: '#3b82f6' },
      { id: 'nop-012', name: 'Trial NOP-012', phase: 'Phase II', status: 'recruiting', sponsor: 'Eli Lilly', enrolled: 12, target: 40, color: '#ec4899' },
      { id: 'qrs-345', name: 'Trial QRS-345', phase: 'Phase I', status: 'active', sponsor: 'Regeneron', enrolled: 7, target: 25, color: '#f59e0b' },
      { id: 'tuv-678', name: 'Trial TUV-678', phase: 'Phase III', status: 'recruiting', sponsor: 'Vertex', enrolled: 35, target: 95, color: '#06b6d4' },
      { id: 'wxy-901', name: 'Trial WXY-901', phase: 'Phase II', status: 'active', sponsor: 'Moderna', enrolled: 20, target: 60, color: '#8b5cf6' },
      { id: 'zab-234', name: 'Trial ZAB-234', phase: 'Phase III', status: 'recruiting', sponsor: 'BioNTech', enrolled: 28, target: 85, color: '#10b981' },
      { id: 'cde-567', name: 'Trial CDE-567', phase: 'Phase I', status: 'active', sponsor: 'Incyte', enrolled: 4, target: 15, color: '#ef4444' },
      { id: 'fgh-890', name: 'Trial FGH-890', phase: 'Phase II', status: 'recruiting', sponsor: 'Biogen', enrolled: 16, target: 50, color: '#6366f1' },
      { id: 'ijk-123', name: 'Trial IJK-123', phase: 'Phase III', status: 'active', sponsor: 'Alexion', enrolled: 42, target: 115, color: '#14b8a6' },
      { id: 'lmn-456', name: 'Trial LMN-456', phase: 'Phase II', status: 'recruiting', sponsor: 'Celgene', enrolled: 14, target: 45, color: '#f97316' },
      { id: 'opq-789', name: 'Trial OPQ-789', phase: 'Phase I', status: 'active', sponsor: 'Genentech', enrolled: 6, target: 20, color: '#a855f7' },
      { id: 'rst-012', name: 'Trial RST-012', phase: 'Phase III', status: 'recruiting', sponsor: 'Abbvie', enrolled: 38, target: 100, color: '#22c55e' },
      { id: 'uvw-345', name: 'Trial UVW-345', phase: 'Phase II', status: 'active', sponsor: 'Novartis', enrolled: 19, target: 55, color: '#3b82f6' },
      { id: 'xyz-678', name: 'Trial XYZ-678', phase: 'Phase I', status: 'recruiting', sponsor: 'GSK', enrolled: 8, target: 25, color: '#ec4899' },
      { id: 'abc-901', name: 'Trial ABC-901', phase: 'Phase III', status: 'active', sponsor: 'Bayer', enrolled: 45, target: 120, color: '#f59e0b' },
    ],
  });

  const loadFullDataset = () => {
    // Full dataset with 25+ trials and extensive data
    const fullDataset = buildFullDataset();
    const stored = localStorage.getItem(STORAGE_KEY_FULL);
    if (stored) {
      try {
        setState(withMode(JSON.parse(stored), "full"));
        return;
      } catch (e) {
        console.error("Failed to parse stored full state:", e);
      }
    }
    const nextState = withMode(fullDataset, "full");
    setState(nextState);
    localStorage.setItem(STORAGE_KEY_FULL, JSON.stringify(nextState));
  };

  const fullResetLocal = (modeOverride?: DemoState["dataMode"]) => {
    const buildingState = withMode(
      {
        tasks: [],
        documents: [],
        milestones: [],
        teamMembers: [
          {
            id: "member-1",
            name: "Kaleb Sanders",
            email: "kaleb.s@themison.com",
            role: "Principal Investigator",
            clinicalRole: "Principal Investigator",
            appRole: "Superadmin",
            team: "Clinical",
            site: "Copenhagen",
            status: "Active",
            initials: "KS",
          },
        ],
        trials: [],
        activeTrials: 0,
        blockedTasks: 0,
        dataMode: "building",
      },
      "building"
    );
    const sampleState = withMode(initialDemoState, "sample");
    const fullState = withMode(buildFullDataset(), "full");
    localStorage.setItem(STORAGE_KEY_BUILDING, JSON.stringify(buildingState));
    localStorage.setItem(STORAGE_KEY_SAMPLE, JSON.stringify(sampleState));
    localStorage.setItem(STORAGE_KEY_FULL, JSON.stringify(fullState));
    const targetMode = modeOverride ?? state.dataMode;
    if (targetMode === "full") {
      setState(fullState);
    } else if (targetMode === "building") {
      setState(buildingState);
    } else {
      setState(sampleState);
    }
  };

  const setBuildingMode = () => {
    const stored = localStorage.getItem(STORAGE_KEY_BUILDING);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setState(withMode(parsed, "building"));
        return;
      } catch (e) {
        console.error("Failed to parse stored building state:", e);
      }
    }
    resetDemo();
  };

  const getCompletedTasksCount = () => {
    return state.tasks.filter((task) => task.completed).length;
  };

  const getActiveTasksCount = () => {
    return state.tasks.filter((task) => !task.completed).length;
  };

  const getCurrentDataMode = () => {
    return state.dataMode;
  };

  return (
    <DemoStateContext.Provider
      value={{
        state,
        updateTask,
        addDocument,
        addTeamMember,
        updateTeamMember,
        updateMilestone,
        resetDemo,
        loadSampleData,
        loadFullDataset,
        fullResetLocal,
        setBuildingMode,
        getCompletedTasksCount,
        getActiveTasksCount,
        getCurrentDataMode,
      }}
    >
      {children}
    </DemoStateContext.Provider>
  );
}

export function useDemoState() {
  const context = useContext(DemoStateContext);
  if (context === undefined) {
    throw new Error("useDemoState must be used within a DemoStateProvider");
  }
  return context;
}
