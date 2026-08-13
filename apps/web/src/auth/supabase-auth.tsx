import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { setSessionAccessToken } from '@/lib/trpc';

type LucidAuthState =
  | { mode: 'legacy'; status: 'ready' }
  | {
      mode: 'supabase';
      status: 'loading' | 'signed-out' | 'signed-in';
      signInWithGoogle: () => Promise<void>;
      signOut: () => Promise<void>;
    };

const AuthContext = createContext<LucidAuthState | undefined>(undefined);

export function LucidAuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const client = useMemo(createConfiguredClient, []);
  const [session, setSession] = useState<Session | null>();
  const activeUserId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!client) {
      setSessionAccessToken(undefined);
      return;
    }
    let active = true;
    const installSession = (nextSession: Session | null) => {
      const nextUserId = nextSession?.user.id;
      if (nextUserId !== activeUserId.current) {
        queryClient.clear();
        activeUserId.current = nextUserId;
      }
      setSession(nextSession);
      setSessionAccessToken(nextSession?.access_token);
    };
    void client.auth.getSession().then(({ data }) => {
      if (active) {
        installSession(data.session);
      }
    });
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, nextSession) => {
        installSession(nextSession);
      },
    );
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      setSessionAccessToken(undefined);
    };
  }, [client, queryClient]);

  const value: LucidAuthState = !client
    ? { mode: 'legacy', status: 'ready' }
    : {
        mode: 'supabase',
        status: session === undefined
          ? 'loading'
          : session ? 'signed-in' : 'signed-out',
        signInWithGoogle: () => signInWithGoogle(client),
        signOut: async () => {
          const { error } = await client.auth.signOut();
          if (error) {
            throw error;
          }
        },
      };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useLucidAuth(): LucidAuthState {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error('LucidAuthProvider is missing.');
  }
  return auth;
}

function createConfiguredClient(): SupabaseClient | undefined {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !publishableKey) {
    return undefined;
  }
  if (!url || !publishableKey) {
    throw new Error('Lucid Supabase browser configuration is incomplete.');
  }
  return createClient(url, publishableKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
}

async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) {
    throw error;
  }
}
