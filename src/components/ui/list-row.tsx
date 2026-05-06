interface ListRowProps {
  avatar: string;
  title: string;
  subtitle: string;
  meta: string;
  badge?: { text: string; color: string };
}

export function ListRow({ avatar, title, subtitle, meta, badge }: ListRowProps) {
  return (
    <div
      className="flex items-center gap-4 py-3 last:border-0"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <span
        className="w-10 h-10 rounded-full grid place-items-center text-button flex-shrink-0"
        style={{ background: 'var(--c-blue)', color: '#FFFFFF' }}
      >
        {avatar}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-button truncate" style={{ color: 'var(--text)' }}>{title}</div>
        <div className="text-caption truncate" style={{ color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>
      {badge && (
        <span
          className="text-caption font-semibold px-2.5 py-1 rounded-full"
          style={{ background: `color-mix(in srgb, ${badge.color} 14%, transparent)`, color: badge.color }}
        >
          {badge.text}
        </span>
      )}
      <span className="text-caption ml-2" style={{ color: 'var(--text-subtle)' }}>{meta}</span>
    </div>
  );
}
