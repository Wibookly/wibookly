// Shared "Brief" visual system — used by TheBrief, TheHelm (emails), and TheHelmCalendar
// so all three surfaces share exactly the same coloring, typography, and layout lines.
export const BRIEF_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;450;500;600;700&display=swap');
.helm *{box-sizing:border-box;margin:0;padding:0}
.helm[data-theme="dark"]{--base:#080B14;--surface:#0F1524;--surface-2:#151D30;--border:#212C44;--border-soft:#1A2338;--text:#EAF0FA;--text-mid:#A7B4CC;--text-dim:#6B7A96;--accent:#17E29E;--accent-2:#22D3EE;--now:#FF6B6B;--today:#F5B942;--later:#22D3EE;--glow:0 8px 40px -12px rgba(6,20,40,.9)}
.helm[data-theme="light"]{--base:#EEF2F9;--surface:#FFFFFF;--surface-2:#F5F8FC;--border:#DCE4F0;--border-soft:#E7EDF6;--text:#0E1526;--text-mid:#46577A;--text-dim:#7A89A6;--accent:#059B77;--accent-2:#0891B2;--now:#E5484D;--today:#C99017;--later:#0891B2;--glow:0 4px 24px -14px rgba(30,50,90,.35)}
.helm{font-family:'Inter',system-ui,sans-serif;background:var(--base);color:var(--text);min-height:100vh;padding:22px;line-height:1.5;-webkit-font-smoothing:antialiased;transition:background .35s,color .35s}
.helm h1,.helm h2,.helm h3,.helm .display{font-family:'Space Grotesk',system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto}
.bridge{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:20px}
.greeting{font-size:30px;font-weight:600;letter-spacing:-.5px}
.greeting .accent{background:linear-gradient(100deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.datemeta{color:var(--text-dim);font-size:13.5px;margin-top:4px;letter-spacing:.2px}
.state{margin-top:12px;font-size:15px;color:var(--text-mid);max-width:640px}
.state b{color:var(--text);font-weight:600}
.controls{display:flex;align-items:center;gap:10px}
.pill{display:inline-flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border);color:var(--text-mid);font-size:12.5px;padding:8px 12px;border-radius:999px;cursor:pointer;transition:.2s;font-family:inherit}
.pill:hover{border-color:var(--accent);color:var(--text)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
.grid{display:grid;grid-template-columns:1.7fr 1fr;gap:18px;align-items:start}
.grid.single{grid-template-columns:1fr}
@media(max-width:880px){.grid{grid-template-columns:1fr}.helm{padding:16px}.greeting{font-size:25px}}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;box-shadow:var(--glow)}
.panel+.panel{margin-top:16px}
.eyebrow{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-dim);font-weight:600;display:flex;align-items:center;gap:8px}
.eyebrow .count{background:var(--surface-2);border:1px solid var(--border-soft);color:var(--text-mid);border-radius:6px;padding:1px 7px;font-size:11px;letter-spacing:0}
.brief{background:radial-gradient(120% 140% at 0% 0%,rgba(23,226,158,.10),transparent 55%),var(--surface)}
.brief-body{font-size:16.5px;line-height:1.62;margin-top:12px;color:var(--text)}
.brief-body .hl{color:var(--accent);font-weight:600}.brief-body .soft{color:var(--text-mid)}
.card{background:var(--surface-2);border:1px solid var(--border-soft);border-radius:14px;padding:15px 16px;margin-top:12px;position:relative;overflow:hidden;transition:.25s;cursor:pointer;animation:rise .4s ease both}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.card:hover{border-color:var(--accent);transform:translateY(-1px)}
.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--rail)}
.card.now{--rail:var(--now)}.card.today{--rail:var(--today)}.card.later{--rail:var(--later)}
.card-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.chip{font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;font-weight:600;padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:5px}
.chip.email{background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent)}
.chip.meeting{background:color-mix(in srgb,var(--accent-2) 16%,transparent);color:var(--accent-2)}
.chip.task{background:color-mix(in srgb,var(--today) 18%,transparent);color:var(--today)}
.chip .ic,.ic{width:12px;height:12px}
.bucket-tag{margin-left:auto;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--rail)}
.prepared{font-size:10.5px;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:6px;padding:2px 7px;font-weight:600}
.autofiled{font-size:10.5px;color:var(--text-dim);border:1px solid var(--border-soft);border-radius:6px;padding:2px 7px;font-weight:600}
.from{font-size:12.5px;color:var(--text-dim);margin-top:10px}.from b{color:var(--text-mid);font-weight:600}
.title{font-size:15.5px;font-weight:600;margin-top:3px;letter-spacing:-.2px}
.why{font-size:13.5px;color:var(--text-mid);margin-top:7px;line-height:1.5}
.reasons{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.reason{font-size:11px;color:var(--text-dim);background:var(--surface);border:1px solid var(--border-soft);border-radius:999px;padding:3px 9px}
.meter-row{display:flex;align-items:center;gap:10px;margin-top:12px}
.meter{flex:1;height:5px;background:var(--border-soft);border-radius:999px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:999px;background:var(--rail);transition:width .6s}
.score{font-size:12px;font-weight:700;color:var(--text-mid);font-variant-numeric:tabular-nums}
.open-hint{position:absolute;right:14px;bottom:13px;font-size:11.5px;color:var(--text-dim);opacity:0;transition:.2s}
.card:hover .open-hint{opacity:1;color:var(--accent)}
.showmore{margin-top:14px;width:100%;background:transparent;border:1px dashed var(--border);color:var(--text-mid);font-family:inherit;font-size:12.5px;font-weight:600;padding:10px;border-radius:10px;cursor:pointer;transition:.2s}
.showmore:hover{border-color:var(--accent);color:var(--text)}
.timeline{margin-top:12px}
.tl{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--border-soft);align-items:flex-start}
.tl:last-child{border-bottom:none}
.tl-time{font-size:12px;font-weight:600;color:var(--text-mid);min-width:78px;font-variant-numeric:tabular-nums;padding-top:1px}
.tl-time.live{color:var(--now)}
.tl-label{font-size:14px;font-weight:500;color:var(--text)}
.tl-flag{font-size:11px;color:var(--today);margin-top:3px}
.tl-meta{font-size:11.5px;color:var(--text-dim);margin-top:3px}
.tl-mark{width:8px;height:8px;border-radius:50%;margin-top:6px;background:var(--accent-2);flex-shrink:0}
.tl-mark.live{background:var(--now);box-shadow:0 0 0 4px color-mix(in srgb,var(--now) 22%,transparent)}
.wait{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-soft)}
.wait:last-child{border-bottom:none}
.wait-who{font-size:13.5px;font-weight:600}.wait-what{font-size:12px;color:var(--text-dim)}
.age{margin-left:auto;font-size:11px;font-weight:700;color:var(--text-dim);background:var(--surface-2);border-radius:6px;padding:2px 7px}
.day-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:14px;margin-bottom:6px}
.day-head:first-child{margin-top:4px}
.day-title{font-family:'Space Grotesk',system-ui,sans-serif;font-size:15px;font-weight:600;color:var(--text)}
.day-sub{font-size:11.5px;color:var(--text-dim);letter-spacing:.4px;text-transform:uppercase}
.week-nav{display:inline-flex;gap:6px}
.week-nav .pill{padding:6px 12px;font-size:12px}
@media(prefers-reduced-motion:reduce){.card,.tl,.wait{animation:none}}
`;

export const briefIc = {
  mail: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  cal: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
};

export const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const relTime = (iso?: string) => {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)}m ago`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)}h ago`;
  return `${Math.round(diff / (60 * 24))}d ago`;
};

export const ageDays = (iso?: string) => {
  if (!iso) return '';
  const d = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  return `${d}d`;
};
