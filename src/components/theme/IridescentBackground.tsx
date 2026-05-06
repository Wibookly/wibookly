/**
 * Iridescent animated blob background. Render once near the root.
 * Sits fixed behind everything (z-index: -1), pointer-events: none.
 */
export function IridescentBackground() {
  const blob = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    borderRadius: '9999px',
    filter: 'blur(90px)',
    ...extra,
  });

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        overflow: 'hidden',
        pointerEvents: 'none',
        background: 'var(--bg)',
      }}
    >
      <div style={blob({ top: '-10%', left: '-10%', width: '55%', height: '55%', background: 'var(--blob-1)', animation: 'iriFloat1 22s ease-in-out infinite' })} />
      <div style={blob({ top: '20%', right: '-15%', width: '60%', height: '60%', background: 'var(--blob-3)', animation: 'iriFloat2 28s ease-in-out infinite' })} />
      <div style={blob({ bottom: '-15%', left: '20%', width: '50%', height: '50%', background: 'var(--blob-2)', animation: 'iriFloat1 32s ease-in-out infinite reverse' })} />
      <div style={blob({ bottom: '10%', right: '10%', width: '40%', height: '40%', background: 'var(--blob-4)', animation: 'iriFloat2 26s ease-in-out infinite reverse' })} />
    </div>
  );
}
