import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const CATEGORY_COLORS = [
  'var(--c-rose)',
  'var(--c-orange)',
  'var(--c-yellow)',
  'var(--c-green)',
  'var(--c-cyan)',
  'var(--c-purple)',
];

export function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div
      className="rounded-2xl p-6 shadow-sm"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-h6" style={{ color: 'var(--text)' }}>Categories</h3>
        <select
          className="text-caption rounded-full px-3 py-1.5"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <option>Top 6</option>
          <option>All</option>
        </select>
      </div>
      <div className="grid md:grid-cols-2 gap-6 items-center">
        <div className="relative h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%" cy="50%"
                innerRadius={70} outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-h4" style={{ color: 'var(--text)' }}>{total.toLocaleString()}</div>
            <div className="text-caption" style={{ color: 'var(--text-muted)' }}>total emails</div>
          </div>
        </div>
        <ul className="space-y-3">
          {data.map((d, i) => {
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(0) : '0';
            return (
              <li key={d.name} className="flex items-center gap-3">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                />
                <span className="flex-1 text-body-2" style={{ color: 'var(--text-body)' }}>{d.name}</span>
                <span className="text-button" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
