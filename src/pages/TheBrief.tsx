import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const NOW = new Date();
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const relTime = (iso) => {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)}m ago`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)}h ago`;
  return `${Math.round(diff / (60 * 24))}d ago`;
};
const ageDays = (iso) => {
  if (!iso) return "";
  const d = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  return `${d}d`;
};

/* --- shape a helm_items row into the card + detail shape this page renders --- */
function mapHelmItem(row) {
  const payload = row.payload || {};
  const score = Number(row.score) || 0;
  const bucket = score >= 75 ? "now" : score >= 40 ? "today" : "later";
  const kind = row.source === "meeting" ? "meeting" : row.source === "task" ? "task" : "email";
  const received = payload.receivedDateTime || row.created_at;
  const preview = (payload.bodyPreview || row.context || "").toString();
  const draft = row.ai_draft || "";
  const firstName = (row.sender_name || "there").split(" ")[0];
  const replies = draft
    ? {
        Direct: draft,
        Warm: `Hi ${firstName} — ${draft}`,
        Brief: draft.length > 220 ? draft.slice(0, 220).trim() + "…" : draft,
        Detailed: draft + "\n\nLet me know if you need any more detail — happy to walk through it.",
      }
    : null;
  const reasons = [];
  if (payload.isDirect) reasons.push("Direct to you");
  if (payload.importance === "high") reasons.push("Marked important");
  if (payload.flagStatus === "flagged") reasons.push("Flagged");
  if (row.is_external) reasons.push("External sender");
  if (row.tier === "overdue") reasons.push("Overdue");
  if (draft) reasons.push("Draft ready");
  if (reasons.length === 0) reasons.push(row.tier || "Open");

  return {
    id: row.id,
    kind,
    bucket,
    score: Math.round(score),
    from: row.sender_name || row.sender_email || "Unknown sender",
    channel: `${kind === "email" ? "Email" : kind === "meeting" ? "Meeting" : "Task"} · ${relTime(received)}`,
    title: row.title || "(no subject)",
    why: preview ? preview.replace(/\s+/g, " ").slice(0, 180) : "Open item on your Helm.",
    reasons,
    prepared: !!draft,
    detail:
      kind === "meeting"
        ? {
            when: received ? new Date(received).toLocaleString() : "",
            attendees: (payload.attendees && payload.attendees.length ? payload.attendees : [row.sender_name || "You"]),
            agenda:
              (Array.isArray(payload.agenda) && payload.agenda.length && payload.agenda) ||
              (draft ? draft.split(/\n+/).filter(Boolean).slice(0, 6) : ["Discuss " + (row.title || "meeting")]),
          }
        : kind === "task"
        ? {
            context: preview || row.title,
            replies: replies || { Draft: "No AI draft yet for this task." },
          }
        : {
            thread: [
              {
                who: row.sender_name || row.sender_email || "Sender",
                when: received ? new Date(received).toLocaleString() : "",
                me: false,
                body: preview || "(no preview available)",
              },
            ],
            replies: replies || { Draft: "No AI draft yet — open the message to compose one." },
          },
  };
}

/* --------------------------------------------------------------- STYLE ---- */
const CSS = `
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
.tl{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--border-soft);align-items:flex-start}
.tl:last-child{border-bottom:none}
.tl-time{font-size:12px;font-weight:600;color:var(--text-mid);min-width:62px;font-variant-numeric:tabular-nums;padding-top:1px}
.tl-time.live{color:var(--now)}
.tl-label{font-size:13.5px}.tl-flag{font-size:11px;color:var(--today);margin-top:2px}
.tl-mark{width:8px;height:8px;border-radius:50%;margin-top:5px;background:var(--accent-2);flex-shrink:0}
.tl-mark.live{background:var(--now);box-shadow:0 0 0 4px color-mix(in srgb,var(--now) 22%,transparent)}
.wait{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-soft)}
.wait:last-child{border-bottom:none}
.wait-who{font-size:13.5px;font-weight:600}.wait-what{font-size:12px;color:var(--text-dim)}
.age{margin-left:auto;font-size:11px;font-weight:700;color:var(--text-dim);background:var(--surface-2);border-radius:6px;padding:2px 7px}

/* ---- DETAIL / FOCUS PAGE ---- */
.detail-wrap{max-width:860px;margin:0 auto;animation:fade .3s ease both}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.back{display:inline-flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);color:var(--text-mid);font-family:inherit;font-size:13px;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer;transition:.2s;margin-bottom:18px}
.back:hover{border-color:var(--accent);color:var(--text)}
.d-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.d-title{font-size:23px;font-weight:600;letter-spacing:-.4px;margin:6px 0 14px}
.msg{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:12px}
.msg.me{background:var(--surface-2)}
.msg-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#04121A;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk'}
.msg-who{font-size:13.5px;font-weight:600}.msg-when{font-size:11.5px;color:var(--text-dim);margin-left:auto}
.msg-body{font-size:14.5px;line-height:1.62;color:var(--text-mid)}
.composer{background:var(--surface);border:1px solid var(--accent);border-radius:14px;padding:16px;margin-top:6px;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 10%,transparent)}
.composer-label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--accent);font-weight:600;display:flex;align-items:center;gap:8px}
.tones{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.tone{font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-mid);cursor:pointer;transition:.18s}
.tone:hover{border-color:var(--text-dim);color:var(--text)}
.tone.on{background:linear-gradient(100deg,var(--accent),var(--accent-2));color:#04121A;border-color:transparent}
.composer textarea{width:100%;background:var(--surface-2);color:var(--text);border:1px solid var(--border-soft);border-radius:10px;padding:13px;font-family:inherit;font-size:14px;line-height:1.6;resize:vertical;min-height:150px}
.composer textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
.d-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:13px}
.btn{font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:9px 15px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text-mid);transition:.18s}
.btn:hover{color:var(--text);border-color:var(--text-dim)}
.btn.primary{background:linear-gradient(100deg,var(--accent),var(--accent-2));color:#04121A;border:none}
.btn.primary:hover{filter:brightness(1.08)}
.info-box{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;font-size:14px;color:var(--text-mid);line-height:1.6}
.meta-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.meta-chip{font-size:12px;color:var(--text-mid);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:5px 12px}
.agenda-item{display:flex;gap:11px;padding:11px 0;border-bottom:1px solid var(--border-soft);align-items:flex-start}
.agenda-item:last-child{border-bottom:none}
.num{width:22px;height:22px;border-radius:7px;background:var(--surface-2);border:1px solid var(--border-soft);color:var(--accent);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'Space Grotesk'}
.agenda-text{font-size:14px;color:var(--text)}
.sent-banner{background:color-mix(in srgb,var(--accent) 14%,transparent);border:1px solid var(--accent);color:var(--accent);border-radius:12px;padding:14px 16px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;animation:rise .3s ease both}
@media(prefers-reduced-motion:reduce){.card,.detail-wrap,.sent-banner{animation:none}}
`;

const Ic = {
  mail:<svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
  cal:<svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>,
  task:<svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v13l-4 4H4z"/><path d="M16 21v-4h4"/></svg>,
};
const kindMeta = { email:{chip:"Email",ic:Ic.mail}, meeting:{chip:"Meeting",ic:Ic.cal}, task:{chip:"Task",ic:Ic.task} };
const bucketLabel = { now:"Now", today:"Today", later:"Later" };
const initials = (n) => n.split(" ").map((w)=>w[0]).slice(0,2).join("").toUpperCase();

/* ------------------------------------------------------- EMAIL FOCUS ------ */
function EmailFocus({ item, onBack }) {
  const tones = Object.keys(item.detail.replies);
  const [tone, setTone] = useState(tones[0]);
  const [text, setText] = useState(item.detail.replies[tones[0]]);
  const [sent, setSent] = useState(false);
  const pick = (t) => { setTone(t); setText(item.detail.replies[t]); };
  return (
    <div className="detail-wrap">
      <button className="back" onClick={onBack}>← Back to the Helm</button>
      <div className="d-head"><span className={`chip email`}>{Ic.mail}Email</span>
        <span className="from"><b>{item.from}</b> · {item.channel}</span></div>
      <div className="d-title">{item.title}</div>

      {item.detail.thread.map((m, i) => (
        <div className={`msg ${m.me ? "me" : ""}`} key={i}>
          <div className="msg-head">
            <div className="avatar">{m.me ? "AR" : initials(m.who)}</div>
            <span className="msg-who">{m.who}</span>
            <span className="msg-when">{m.when}</span>
          </div>
          <div className="msg-body">{m.body}</div>
        </div>
      ))}

      {sent ? (
        <div className="sent-banner">✓ Reply sent — thread closed and cleared from the Helm.</div>
      ) : (
        <div className="composer">
          <div className="composer-label">✦ AI-generated reply — pick a tone or edit</div>
          <div className="tones">
            {tones.map((t) => (
              <button key={t} className={`tone ${tone === t ? "on" : ""}`} onClick={() => pick(t)}>{t}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
          <div className="d-actions">
            <button className="btn primary" onClick={() => setSent(true)}>Send reply</button>
            <button className="btn" onClick={() => pick(tone)}>Regenerate</button>
            <button className="btn" onClick={onBack}>Save & close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------- MEETING FOCUS ------ */
function MeetingFocus({ item, onBack }) {
  const [agenda, setAgenda] = useState(item.detail.agenda);
  const [sent, setSent] = useState(false);
  return (
    <div className="detail-wrap">
      <button className="back" onClick={onBack}>← Back to the Helm</button>
      <div className="d-head"><span className="chip meeting">{Ic.cal}Meeting</span></div>
      <div className="d-title">{item.title}</div>
      <div className="meta-row">
        <span className="meta-chip">🕐 {item.detail.when}</span>
        <span className="meta-chip">👥 {item.detail.attendees.join(", ")}</span>
      </div>
      <div className="composer">
        <div className="composer-label">✦ AI-built agenda — drawn from your open threads & calendar</div>
        <div style={{ marginTop: 12 }}>
          {agenda.map((a, i) => (
            <div className="agenda-item" key={i}>
              <span className="num">{i + 1}</span>
              <span className="agenda-text">{a}</span>
            </div>
          ))}
        </div>
        {sent ? (
          <div className="sent-banner" style={{ marginTop: 14 }}>✓ Agenda sent to all 4 attendees.</div>
        ) : (
          <div className="d-actions">
            <button className="btn primary" onClick={() => setSent(true)}>Send agenda to attendees</button>
            <button className="btn" onClick={() => setAgenda([...agenda])}>Regenerate</button>
            <button className="btn" onClick={onBack}>Save & close</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- TASK FOCUS ------ */
function TaskFocus({ item, onBack }) {
  const tones = Object.keys(item.detail.replies);
  const [tone, setTone] = useState(tones[0]);
  const [text, setText] = useState(item.detail.replies[tones[0]]);
  const [sent, setSent] = useState(false);
  const pick = (t) => { setTone(t); setText(item.detail.replies[t]); };
  return (
    <div className="detail-wrap">
      <button className="back" onClick={onBack}>← Back to the Helm</button>
      <div className="d-head"><span className="chip task">{Ic.task}Task</span>
        <span className="from">{item.channel}</span></div>
      <div className="d-title">{item.title}</div>
      <div className="info-box" style={{ marginBottom: 14 }}>{item.detail.context}</div>
      {sent ? (
        <div className="sent-banner">✓ Email sent to CLEAR — task marked done and cleared from the Helm.</div>
      ) : (
        <div className="composer">
          <div className="composer-label">✦ AI-drafted outreach — pick a tone or edit</div>
          <div className="tones">
            {tones.map((t) => (
              <button key={t} className={`tone ${tone === t ? "on" : ""}`} onClick={() => pick(t)}>{t}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
          <div className="d-actions">
            <button className="btn primary" onClick={() => setSent(true)}>Send email</button>
            <button className="btn" onClick={() => pick(tone)}>Regenerate</button>
            <button className="btn" onClick={onBack}>Save & close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ THE BRIEF PAGE ---- */
export default function TheBrief() {
  const [theme, setTheme] = useState("dark");
  const [openId, setOpenId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [clock, setClock] = useState(NOW);
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(t); }, []);

  const sorted = useMemo(() => ITEMS.slice().sort((a, b) => b.score - a.score), []);
  const visible = showAll ? sorted : sorted.slice(0, 4);
  const hidden = sorted.length - 4;
  const nowCount = sorted.filter((i) => i.bucket === "now").length;
  const openItem = sorted.find((i) => i.id === openId);
  const greetWord = clock.getHours() < 12 ? "Good morning" : clock.getHours() < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <style>{CSS}</style>
      <div className="helm" data-theme={theme}>
        {openItem ? (
          <div className="wrap">
            {openItem.kind === "email" && <EmailFocus item={openItem} onBack={() => setOpenId(null)} />}
            {openItem.kind === "meeting" && <MeetingFocus item={openItem} onBack={() => setOpenId(null)} />}
            {openItem.kind === "task" && <TaskFocus item={openItem} onBack={() => setOpenId(null)} />}
          </div>
        ) : (
          <div className="wrap">
            <div className="bridge">
              <div>
                <div className="greeting display">{greetWord}, <span className="accent">Ali</span></div>
                <div className="datemeta">
                  {clock.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · {fmtTime(clock)} · The Helm › The Brief
                </div>
                <div className="state">
                  <b>{nowCount} things</b> need you before noon. <b>2 meetings</b> today, two without an agenda.
                  <b> 1 thread</b> is waiting on your reply.
                </div>
              </div>
              <div className="controls">
                <span className="pill"><span className="dot" />Brief updated 4 min ago</span>
                <button className="pill" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
                  {theme === "dark" ? "☾ Dark" : "☀ Light"}
                </button>
              </div>
            </div>

            <div className="grid">
              <div>
                <div className="panel brief">
                  <div className="eyebrow">Your brief</div>
                  <div className="brief-body">
                    Your day is front-loaded. <span className="hl">Dustin needs a call on the Anaheim scanner
                    rollout</span> before your 11:00 — I've drafted your reply, tap it to review.
                    <span className="soft"> Kari's invoice question can wait until after lunch.</span> Your
                    2:00 demo has no agenda yet — worth two minutes now.
                  </div>
                </div>

                <div className="panel">
                  <div className="eyebrow">Needs you <span className="count">{sorted.length} open</span></div>
                  {visible.map((it) => {
                    const meta = kindMeta[it.kind];
                    return (
                      <div key={it.id} className={`card ${it.bucket}`} onClick={() => setOpenId(it.id)}
                        role="button" tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setOpenId(it.id)}>
                        <div className="card-top">
                          <span className={`chip ${it.kind}`}>{meta.ic}{meta.chip}</span>
                          {it.prepared && <span className="prepared">✦ Draft ready</span>}
                          {it.autofiled && <span className="autofiled">Auto-filed</span>}
                          <span className="bucket-tag">{bucketLabel[it.bucket]}</span>
                        </div>
                        <div className="from"><b>{it.from}</b> · {it.channel}</div>
                        <div className="title">{it.title}</div>
                        <div className="why">{it.why}</div>
                        <div className="reasons">{it.reasons.map((r) => <span key={r} className="reason">{r}</span>)}</div>
                        <div className="meter-row">
                          <div className="meter"><i style={{ width: `${it.score}%` }} /></div>
                          <span className="score">{it.score}</span>
                        </div>
                        <span className="open-hint">Open →</span>
                      </div>
                    );
                  })}
                  {!showAll && hidden > 0 && (
                    <button className="showmore" onClick={() => setShowAll(true)}>
                      Show {hidden} more · open full queue
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="panel">
                  <div className="eyebrow">Today</div>
                  <div className="timeline">
                    {schedule.map((s, i) => (
                      <div className="tl" key={i}>
                        <span className={`tl-time ${s.live ? "live" : ""}`}>{s.time}</span>
                        <span className={`tl-mark ${s.live ? "live" : ""}`} />
                        <div><div className="tl-label">{s.label}</div>{s.flag && <div className="tl-flag">⚑ {s.flag}</div>}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="panel">
                  <div className="eyebrow">Waiting on you <span className="count">{waiting.length}</span></div>
                  <div style={{ marginTop: 10 }}>
                    {waiting.map((w, i) => (
                      <div className="wait" key={i}>
                        <div><div className="wait-who">{w.who}</div><div className="wait-what">{w.what}</div></div>
                        <span className="age">{w.age}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
