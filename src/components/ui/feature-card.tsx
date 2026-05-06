interface FeatureCardProps {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}

export function FeatureCard({ eyebrow, title, children }: FeatureCardProps) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-7 shadow-glow"
      style={{ background: 'var(--grad-feature)', color: '#FFFFFF' }}
    >
      <div
        aria-hidden="true"
        className="absolute -top-20 -right-20 w-72 h-72 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(192,38,211,0.6) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div className="relative">
        {eyebrow && (
          <div className="text-overline mb-3" style={{ opacity: 0.8 }}>{eyebrow}</div>
        )}
        <h3 className="text-h4 mb-4" style={{ color: '#FFFFFF' }}>{title}</h3>
        <div className="text-body-2 leading-relaxed" style={{ opacity: 0.95 }}>{children}</div>
      </div>
    </div>
  );
}
