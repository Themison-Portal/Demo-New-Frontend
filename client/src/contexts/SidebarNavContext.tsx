import { createContext, useContext, useState, ReactNode } from 'react';
import { useLocation } from 'wouter';

export type SidebarNavState = 
  | { type: 'main' }
  | { type: 'trial-list' }
  | { type: 'trial-detail', trialId: string };

interface SidebarNavContextType {
  navState: SidebarNavState;
  setNavState: (state: SidebarNavState) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  openTrialList: () => void;
  openTrialDetail: (trialId: string) => void;
  backToMain: () => void;
  backToTrialList: () => void;
}

const SidebarNavContext = createContext<SidebarNavContextType | undefined>(undefined);

export function SidebarNavProvider({ children }: { children: ReactNode }) {
  const [navState, setNavState] = useState<SidebarNavState>({ type: 'main' });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [, setLocation] = useLocation();

  const openTrialList = () => {
    setNavState({ type: 'trial-list' });
    setLocation('/workspace');
  };

  const openTrialDetail = (trialId: string) => {
    setNavState({ type: 'trial-detail', trialId });
  };

  const backToMain = () => {
    setNavState({ type: 'main' });
  };

  const backToTrialList = () => {
    setNavState({ type: 'trial-list' });
  };

  return (
    <SidebarNavContext.Provider
      value={{
        navState,
        setNavState,
        isCollapsed,
        setIsCollapsed,
        openTrialList,
        openTrialDetail,
        backToMain,
        backToTrialList,
      }}
    >
      {children}
    </SidebarNavContext.Provider>
  );
}

export function useSidebarNav() {
  const context = useContext(SidebarNavContext);
  if (context === undefined) {
    throw new Error('useSidebarNav must be used within a SidebarNavProvider');
  }
  return context;
}
