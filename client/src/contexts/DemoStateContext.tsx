/**
 * Demo State Context
 * Manages persistent interconnected state across all pages using localStorage
 * Survives page navigation and browser refresh, can be reset to initial state
 */

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

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
      initials: "KS",
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
  updateMilestone: (milestoneId: string, updates: Partial<Milestone>) => void;
  resetDemo: () => void;
  loadSampleData: () => void;
  loadFullDataset: () => void;
  setBuildingMode: () => void;
  getCompletedTasksCount: () => number;
  getActiveTasksCount: () => number;
  getCurrentDataMode: () => 'sample' | 'full' | 'building';
}

const DemoStateContext = createContext<DemoStateContextType | undefined>(undefined);

const STORAGE_KEY = "themison-demo-state";

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(() => {
    // Load from localStorage on initial mount
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error("Failed to parse stored state:", e);
        return initialDemoState;
      }
    }
    return initialDemoState;
  });

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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
          initials: "KS",
        },
      ],
      trials: [],
      activeTrials: 0,
      blockedTasks: 0,
      dataMode: 'building',
    };
    setState(emptyState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyState));
  };

  const loadSampleData = () => {
    setState(initialDemoState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initialDemoState));
  };

  const loadFullDataset = () => {
    // Full dataset with 25+ trials and extensive data
    const fullDataset: DemoState = {
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
        { id: "member-2", name: "Sarah Chen", email: "s.chen@themison.com", role: "Clinical Coordinator", initials: "SC" },
        { id: "member-3", name: "Michael Torres", email: "m.torres@themison.com", role: "Data Manager", initials: "MT" },
        { id: "member-4", name: "Emily Rodriguez", email: "e.rodriguez@themison.com", role: "Research Nurse", initials: "ER" },
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
    };
    setState(fullDataset);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fullDataset));
  };

  const setBuildingMode = () => {
    setState((prev) => ({
      ...prev,
      dataMode: 'building',
    }));
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
        updateMilestone,
        resetDemo,
        loadSampleData,
        loadFullDataset,
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
