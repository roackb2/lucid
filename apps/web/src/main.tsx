import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LucidAuthProvider } from './auth/supabase-auth';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 500,
    },
  },
});

const root = document.getElementById('root');

if (!root) {
  throw new Error('Lucid could not find its application root.');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LucidAuthProvider>
          <App />
          <Toaster
            closeButton
            position="bottom-right"
            richColors
            theme="light"
          />
        </LucidAuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
