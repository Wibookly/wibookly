import { ReactNode } from 'react';

type Accent = 'purple' | 'blue' | 'green' | 'orange' | 'cyan' | 'pink';

const GRADIENTS: Record<Accent, string> = {
  purple: 'linear-gradient(135deg, #5B21B6 0%, #8B5CF6 50%, #EC4899 100%)',
  blue:   'linear-gradient(135deg, #1E3A8A 0%, #2B6EE3 55%, #06B6D4 100%)',
  green:  'linear-gradient(135deg, #064E3B 0%, #10B981 55%, #84CC16 100%)',
  orange: 'linear-gradient(135deg, #7C2D12 0%, #F97316 55%, #F4B400 100%)',
  cyan:   'linear-gradient(135deg, #0E7490 0%, #06B6D4 55%, #6FB2F2 100%)',
  pink:   'linear-gradient(135deg, #831843 0%, #EC4899 55%, #F97316 100%)',
};

const GLOW_COLORS: Record<Accent, string> = {
  purple: 'rgba(192,38,211,0.55)',
  blue:   'rgba(6,182,212,0.55)',
  green:  'rgba(132,204,22,0.50)',
  orange: 'rgba(244,180,0,0.55)',
  cyan:   'rgba(111,178,242,0.55)',
  pink:   'rgba(249,115,22,0.55)',
};

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description?: string;
  accent?: Accent;
  actions?: ReactNode;
  icon?: ReactNode;
  /** Optional override for the title's font-size / wrapping classes. */
  titleClassName?: string;
}

/**
 * Standardized page header used at the top of every primary page.
 * Same shape / typography across the app, with a per-page accent color.
 */
export function PageHero({
  eyebrow,
  title,
  description,
  accent = 'purple',
  actions,
  icon,
  titleClassName,
}: PageHeroProps) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 lg:p-7 shadow-glow"
      style={{ background: GRADIENTS[accent], color: '#FFFFFF' }}
      data-page-hero="true"
    >
      <div
        aria-hidden="true"
        className="absolute -top-24 -right-20 w-72 h-72 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${GLOW_COLORS[accent]} 0%, transparent 70%)`,
          filter: 'blur(40px)',
        }}
      />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-overline mb-2" style={{ opacity: 0.85 }}>
              {eyebrow}
            </div>
          )}
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className="grid place-items-center w-10 h-10 rounded-xl shrink-0"
                style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
              >
                {icon}
              </div>
            )}
            <h1
              className={titleClassName ?? 'text-h4 md:text-h3'}
              style={{ color: '#FFFFFF', margin: 0, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              {title}
            </h1>
          </div>
          {description && (
            <p
              className="text-body-2 mt-2 max-w-2xl"
              style={{ color: '#FFFFFF', opacity: 0.92 }}
            >
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>
        )}
      </div>
    </div>
  );
}
