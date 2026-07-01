import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import AppShell from '../components/AppShell';
import { AuthProvider, useAuth } from '../context/AuthContext';
import '../styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function RouteGuard({ Component, pageProps }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isLoginPage = router.pathname === '/login';

  useEffect(() => {
    if (loading) return;
    if (!user && !isLoginPage) router.replace('/login');
    if (user  && isLoginPage)  router.replace('/');
  }, [user, loading, isLoginPage, router]);

  if (isLoginPage) return <Component {...pageProps} />;

  if (loading || !user) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg)', fontFamily:'var(--font)' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ width:32, height:32, border:'3px solid var(--accent-bdr)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.7s linear infinite', margin:'0 auto 12px' }}/>
          <div style={{ fontSize:13, color:'var(--text-2)' }}>Loading…</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <AppShell>
      <Component {...pageProps} />
    </AppShell>
  );
}

export default function App({ Component, pageProps }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouteGuard Component={Component} pageProps={pageProps} />
      </AuthProvider>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }}/>
    </QueryClientProvider>
  );
}
