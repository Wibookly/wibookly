import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type SecretInfo = { present: boolean; length: number; preview: string | null };
export type SecretMap = Record<string, SecretInfo>;

let cache: SecretMap | null = null;
const listeners = new Set<(m: SecretMap) => void>();

async function load(): Promise<SecretMap> {
  const { data, error } = await supabase.functions.invoke('admin-secret-status', { body: {} });
  if (error || !data?.ok) return {};
  cache = (data.secrets ?? {}) as SecretMap;
  listeners.forEach((l) => l(cache!));
  return cache;
}

export function useSecretStatus() {
  const [secrets, setSecrets] = useState<SecretMap>(cache ?? {});
  const [loading, setLoading] = useState(!cache);

  const refresh = useCallback(async () => {
    setLoading(true);
    const m = await load();
    setSecrets(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    const cb = (m: SecretMap) => setSecrets({ ...m });
    listeners.add(cb);
    if (!cache) refresh();
    return () => { listeners.delete(cb); };
  }, [refresh]);

  return { secrets, loading, refresh };
}

export function bustSecretCache() { cache = null; }
