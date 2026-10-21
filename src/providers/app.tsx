import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSchoolYears, useSettings } from '@/lib/queries';
import type { SchoolSettings, SchoolYear } from '@/lib/types';
import { todayPH } from '@/lib/utils';

interface AppState {
  settings: SchoolSettings | undefined;
  schoolYears: SchoolYear[];
  activeSchoolYear: SchoolYear | null;
  /** Working date chosen in the top bar; default date for new records and "Today". */
  workingDate: string;
  setWorkingDate: (d: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const { data: schoolYears = [] } = useSchoolYears();
  const [workingDate, setWorkingDate] = useState(todayPH());
  const value = useMemo<AppState>(() => {
    const byDate = schoolYears.find((y) => workingDate >= y.start_date && workingDate <= y.end_date);
    return {
      settings,
      schoolYears,
      activeSchoolYear: byDate ?? schoolYears.find((y) => y.is_active) ?? null,
      workingDate,
      setWorkingDate: (d) => setWorkingDate(d > todayPH() ? todayPH() : d),
    };
  }, [settings, schoolYears, workingDate]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
