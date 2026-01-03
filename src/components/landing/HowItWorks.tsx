import { Mail, FolderOpen, Sparkles, ArrowRight } from 'lucide-react';

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
    <section id="how-it-works" className="py-24 md:py-36 bg-secondary/30">
      <div className="container mx-auto px-6">
        <div className="text-center mb-20">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4 animate-fade-in">
            Simple Setup
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight animate-fade-in" style={{ animationDelay: '100ms' }}>
            How It Works
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto animate-fade-in" style={{ animationDelay: '200ms' }}>
            Three simple steps to transform your email workflow
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="relative group animate-fade-in"
              style={{ animationDelay: `${300 + index * 100}ms` }}
            >
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 left-[60%] w-full h-0.5 bg-gradient-to-r from-border to-transparent">
                  <ArrowRight className="absolute -right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-border" />
                </div>
              )}
              
              <div className="relative bg-card rounded-2xl p-8 border border-border hover:border-primary/30 hover:shadow-lg transition-all duration-300 group-hover:-translate-y-1">
                {/* Step number badge */}
                <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shadow-md">
                  {step.step}
                </div>
                
                <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-secondary mb-6 group-hover:bg-primary/10 transition-colors">
                  <step.icon className="w-7 h-7 text-foreground group-hover:text-primary transition-colors" />
                </div>
                
                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
