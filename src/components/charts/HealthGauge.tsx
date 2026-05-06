import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const GAUGE_COLORS = ['#F43F5E', '#FF5C1A', '#FFD43B', '#7FE85A', '#15D4F0', '#8B5CF6'];

export function HealthGauge({ score, label }: { score: number; label: string }) {
  const segments = GAUGE_COLORS.map((c) => ({ value: 1, color: c }));

  return (
    <div
      className="rounded-2xl p-6 shadow-sm"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-h6" style={{ color: 'var(--text)' }}>Inbox Health</h3>
        <span className="text-caption" style={{ color: 'var(--text-subtle)' }}>Updated 1hr ago</span>
      </div>
      <div className="relative h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              cx="50%" cy="85%"
              startAngle={180} endAngle={0}
              innerRadius={80} outerRadius={120}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {segments.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center -mt-4">
        <div className="text-h2" style={{ color: 'var(--text)' }}>{score}%</div>
        <div className="text-subtitle" style={{ color: 'var(--text-muted)' }}>{label}</div>
      </div>
    </div>
  );
}
