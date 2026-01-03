import { Mail, FolderOpen, Sparkles } from 'lucide-react';

const steps = [
  {
    icon: Mail,
    step: '01',
    title: 'Connect Outlook',
    description: 'Securely connect your Microsoft Outlook account with OAuth. We never see your password.'
  },
  {
    icon: FolderOpen,
    step: '02',
    title: 'Customize Categories',
    description: 'Create custom categories and rules to automatically sort incoming emails.'
  },
  {
    icon: Sparkles,
    step: '03',
    title: 'Review AI Drafts',
    description: 'Let AI generate draft replies for each category. Review and send when ready.'
  }
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-32 bg-secondary/30">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            How It Works
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Three simple steps to transform your email workflow
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="relative bg-card rounded-lg p-8 border border-border hover:border-foreground/20 transition-colors"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-secondary">
                  <step.icon className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">{step.step}</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
