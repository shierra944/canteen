import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/providers/auth';
import { ThemeProvider, useTheme } from '@/providers/theme';
import { App } from './App';
import { setupInstall } from '@/lib/install';
import './index.css';

setupInstall();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

function ThemedToaster() {
  const { dark } = useTheme();
  return <Toaster position="top-right" richColors closeButton theme={dark ? 'dark' : 'light'} toastOptions={{ className: 'font-sans' }} />;
}

// Data router (needed for unsaved-changes blocking); routes live in <App />.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ThemeProvider>
        <AuthProvider>
          <App />
          <ThemedToaster />
        </AuthProvider>
      </ThemeProvider>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
