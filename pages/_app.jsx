import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import AppShell from '../components/AppShell';
import '../styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
});

export default function App({ Component, pageProps }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <Component {...pageProps} />
      </AppShell>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }}/>
    </QueryClientProvider>
  );
}
