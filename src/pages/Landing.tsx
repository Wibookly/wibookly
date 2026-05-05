import { useNavigate } from 'react-router-dom';
import { Sparkles, Inbox, PenTool, Sun } from 'lucide-react';
import { InboxIQLogo } from '@/components/app/InboxIQLogo';

function EFMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-label="EnergyForward">
      <rect x="4" y="8" width="14" height="3" rx="1" fill="hsl(var(--ef-navy))" />
      <rect x="4" y="14" width="10" height="3" rx="1" fill="hsl(var(--ef-navy))" />
      <rect x="4" y="20" width="12" height="3" rx="1" fill="hsl(var(--ef-navy))" />
      <rect x="4" y="26" width="8" height="3" rx="1" fill="hsl(var(--ef-navy))" />
      <rect x="22" y="8" width="14" height="3" rx="1" fill="hsl(var(--ef-sky))" />
      <rect x="22" y="14" width="10" height="3" rx="1" fill="hsl(var(--ef-sky))" />
      <rect x="22" y="20" width="12" height="3" rx="1" fill="hsl(var(--ef-sky))" />
      <rect x="22" y="26" width="8" height="3" rx="1" fill="hsl(var(--ef-sky))" />
    </svg>
  );
}

const features = [
  {
    icon: Inbox,
    title: 'AI Categorization',
    desc: 'Sorts every inbound email into urgent, action-needed, awaiting-reply, meetings, and FYI buckets.',
  },
  {
    icon: PenTool,
    title: 'Smart Drafts',
    desc: 'Reads the thread and writes the reply in your voice. You review and send.',
  },
  {
    icon: Sun,
    title: 'Daily Brief',
    desc: 'A two-minute morning summary of what needs your attention, before you open the inbox.',
  },
];

const metrics = [
  { value: '94%', label: 'Auto-classified' },
  { value: '3 hrs', label: 'Saved per week' },
  { value: '2', label: 'AI agents' },
  { value: '1', label: 'Inbox, sorted' },
];

export default function Landing() {
  const navigate = useNavigate();
  const signIn = () => navigate('/auth');
  const getStarted = () => navigate('/auth?mode=signup');

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* HEADER */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/75 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <EFMark className="h-8 w-8" />
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">EnergyForward</span>
              <InboxIQLogo className="text-lg leading-none font-display italic" />
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Product</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
            <a href="#about" className="text-sm text-muted-foreground hover:text-foreground transition-colors">About</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={signIn} className="border border-border bg-card hover:border-ef-blue rounded-full px-5 py-2 text-sm font-medium transition-all">
              Sign in
            </button>
            <button onClick={getStarted} className="bg-ef-navy text-white hover:bg-ef-blue rounded-full px-5 py-2 text-sm font-medium transition-all">
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="font-mono text-[11px] tracking-[0.16em] text-ef-blue uppercase">
          AI-NATIVE FOR EMAIL · CALLS · SCHEDULING
        </div>
        <h1 className="font-display italic text-6xl md:text-7xl tracking-tight text-foreground mt-6 leading-[1.05]">
          Bringing tomorrow's{' '}
          <em className="not-italic">
            <span className="bg-gradient-to-r from-ef-blue to-ef-sky bg-clip-text text-transparent">energy</span>
          </em>
          <br />
          to today's inbox.
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground mt-6 max-w-2xl mx-auto leading-relaxed">
          Organize your inbox with AI-powered categorization, smart drafts, and a daily brief that knows what matters before you do.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-10">
          <button onClick={getStarted} className="bg-ef-navy text-white hover:bg-ef-blue rounded-full px-6 py-3 text-base font-medium transition-all">
            Start free trial
          </button>
          <button className="bg-card border border-border hover:border-ef-blue rounded-full px-6 py-3 text-base font-medium text-foreground transition-all">
            Watch demo
          </button>
        </div>
      </section>

      {/* METRICS */}
      <section className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-8 border-y border-border">
        {metrics.map((m) => (
          <div key={m.label} className="text-center">
            <div className="font-display italic text-4xl text-foreground">{m.value}</div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground mt-2">{m.label}</div>
          </div>
        ))}
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <h2 className="font-display italic text-4xl tracking-tight text-foreground text-center max-w-2xl mx-auto">
          Inbox intelligence, with the lights on.
        </h2>
        <p className="text-muted-foreground text-center mt-4 max-w-xl mx-auto">
          Three agents, one workflow. InboxIQ keeps your day moving so you can focus on the work that matters.
        </p>
        <div className="grid md:grid-cols-3 gap-6 mt-16">
          {features.map((f) => (
            <div key={f.title} className="bg-card border border-border rounded-2xl p-8 hover:-translate-y-1 hover:border-ef-sky-soft transition-all">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-ef-blue/[0.14] to-ef-sky/[0.08] grid place-items-center text-ef-blue dark:text-ef-sky">
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="font-display italic text-2xl text-foreground mt-6">{f.title}</h3>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <div className="rounded-2xl p-12 md:p-16 bg-gradient-to-br from-ef-navy to-ef-navy-2 text-white text-center relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-ef-sky/30 blur-3xl pointer-events-none" />
          <Sparkles className="h-8 w-8 mx-auto text-ef-sky relative" />
          <h2 className="font-display italic text-4xl text-white relative mt-4">
            Ready to give your inbox a brain?
          </h2>
          <p className="text-white/75 mt-4 max-w-xl mx-auto relative">
            Join teams using InboxIQ to triage faster, draft smarter, and start each day with a brief that already knows what matters.
          </p>
          <button onClick={getStarted} className="bg-white text-ef-navy hover:bg-ef-sky-soft rounded-full px-6 py-3 text-base font-medium mt-8 inline-block transition-all relative">
            Start free trial
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <EFMark className="h-6 w-6" />
          <span className="text-sm text-muted-foreground">© 2026 EnergyForward · InboxIQ</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</a>
          <a href="#terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</a>
          <a href="#status" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Status</a>
        </div>
      </footer>
    </div>
  );
}
