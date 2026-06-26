// Signed OAuth state: prevents tampering with userId / organizationId in the
// `state` round-trip parameter. We HMAC-SHA256 the JSON payload with
// TOKEN_ENCRYPTION_KEY (server-only Supabase secret) and pack as
// base64url(payload).base64url(sig). The callback re-computes the HMAC and
// rejects any state whose signature does not match.

const KEY = Deno.env.get('TOKEN_ENCRYPTION_KEY') ?? '';

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmac(payload: Uint8Array): Promise<Uint8Array> {
  if (!KEY) throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
}

export async function signState(obj: Record<string, unknown>): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(obj));
  const sig = await hmac(payload);
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export async function verifyState<T = Record<string, unknown>>(
  state: string,
): Promise<T | null> {
  try {
    // Backwards-compat: legacy unsigned base64 JSON (no dot) is rejected.
    if (!state.includes('.')) return null;
    const [p, s] = state.split('.');
    const payload = b64urlDecode(p);
    const sig = b64urlDecode(s);
    const expected = await hmac(payload);
    if (expected.length !== sig.length) return null;
    // constant-time compare
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ sig[i];
    if (diff !== 0) return null;
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch {
    return null;
  }
}
