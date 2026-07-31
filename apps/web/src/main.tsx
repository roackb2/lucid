import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
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
      <App />
      <Toaster
        closeButton
        position="bottom-right"
        richColors
        theme="light"
      />
    </QueryClientProvider>
  </StrictMode>,
);
