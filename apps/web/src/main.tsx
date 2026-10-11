import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { RealtimeProvider } from './lib/RealtimeProvider';
import { installThemes, ThemeProvider } from './theme/ThemeProvider';
import './styles.css';

installThemes();

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>
          <App />
        </RealtimeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
