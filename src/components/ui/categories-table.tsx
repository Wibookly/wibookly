import { Toggle } from './toggle-pill';

export interface CategoryRow {
  id: string | number;
  name: string;
  color: string;
  aiStyle: string;
  active: boolean;
  aiDraft: boolean;
  autoReply: boolean;
  lastSync: string;
}

interface CategoriesTableProps {
  categories: CategoryRow[];
  onChange?: (id: CategoryRow['id'], patch: Partial<CategoryRow>) => void;
}

export function CategoriesTable({ categories, onChange }: CategoriesTableProps) {
  const COLS = 'grid-cols-[40px_1fr_180px_80px_80px_80px_100px]';

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-sm"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div
        className={`grid ${COLS} gap-4 px-6 py-4`}
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}
      >
        <div className="text-overline" style={{ color: 'var(--text-subtle)' }}>Color</div>
        <div className="text-overline" style={{ color: 'var(--text-subtle)' }}>Category</div>
        <div className="text-overline" style={{ color: 'var(--text-subtle)' }}>AI Style</div>
        <div className="text-overline" style={{ color: 'var(--text-subtle)' }}>Active</div>
        <div className="text-overline" style={{ color: 'var(--text-subtle)' }}>AI Draft</div>
        <div className="text-overline" style={{ color: 'var(--text-subtle)' }}>Auto-Reply</div>
        <div className="text-overline text-right" style={{ color: 'var(--text-subtle)' }}>Status</div>
      </div>

      {categories.map((cat, idx) => (
        <div
          key={cat.id}
          className={`grid ${COLS} gap-4 px-6 py-4 items-center transition-colors`}
          style={{
            borderBottom: idx === categories.length - 1 ? 'none' : '1px solid var(--border)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="w-3.5 h-3.5 rounded-full" style={{ background: cat.color }} />
          <input
            value={cat.name}
            onChange={(e) => onChange?.(cat.id, { name: e.target.value })}
            className="bg-transparent text-body-2 border-0 focus:outline-none focus:ring-2 focus:ring-primary rounded px-2 py-1 -mx-2 -my-1"
            style={{ color: 'var(--text)' }}
          />
          <span className="text-body-2" style={{ color: 'var(--text-muted)' }}>{cat.aiStyle}</span>
          <Toggle checked={cat.active} onChange={(v) => onChange?.(cat.id, { active: v })} />
          <Toggle checked={cat.aiDraft} onChange={(v) => onChange?.(cat.id, { aiDraft: v })} />
          <Toggle checked={cat.autoReply} onChange={(v) => onChange?.(cat.id, { autoReply: v })} />
          <span className="text-caption text-right" style={{ color: 'var(--success)' }}>
            ✓ {cat.lastSync}
          </span>
        </div>
      ))}
    </div>
  );
}
