import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export function VolumeArea({ data }: { data: { day: string; value: number }[] }) {
  return (
    <div
      className="rounded-2xl p-6 shadow-sm"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-h6" style={{ color: 'var(--text)' }}>Email Volume</h3>
        <select
          className="text-caption rounded-full px-3 py-1.5"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <option>Last 6 weeks</option>
          <option>Last 6 months</option>
        </select>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="vol-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--c-purple)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--c-purple)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 12,
                fontSize: 13,
                color: 'var(--text)',
              }}
            />
            <Area type="monotone" dataKey="value" stroke="var(--c-purple)" strokeWidth={2.5} fill="url(#vol-grad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
