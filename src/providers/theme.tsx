import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'qnhs.theme';

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const ThemeContext = createContext<{ mode: ThemeMode; dark: boolean; setMode: (m: ThemeMode) => void }>({
  mode: 'system',
  dark: false,
  setMode: () => undefined,
});

/** Light / dark appearance. Printed reports always use the light palette (see index.css). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [sysDark, setSysDark] = useState(systemDark);
  const dark = mode === 'dark' || (mode === 'system' && sysDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSysDark(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try {
      if (m === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, m);
    } catch {
      /* preference just won't persist */
    }
  };

  return <ThemeContext.Provider value={{ mode, dark, setMode }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** True while the dark palette is on screen (used for chart colours). */
export const isDarkNow = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
