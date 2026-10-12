'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RealtimeProvider } from '../lib/RealtimeProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ToastProvider, TooltipProvider } from '../ui';

/** App-wide client state: theme, query cache, the one WebSocket, tooltips and toasts. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>
          <TooltipProvider>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
        </RealtimeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
