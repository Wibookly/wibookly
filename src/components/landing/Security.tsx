import { Shield, Key, Lock, CheckCircle2 } from 'lucide-react';

const securityFeatures = [
  {
    icon: Key,
    title: 'OAuth-based Access',
    description: 'We use industry-standard OAuth 2.0. Your credentials stay with Microsoft.'
  },
  {
    icon: Lock,
    title: 'No Password Storage',
    description: 'We never ask for or store your email password. Ever.'
  },
  {
    icon: Shield,
    title: 'Enterprise-grade Security',
    description: 'Bank-level encryption for all data in transit and at rest.'
  }
];

const securityChecks = [
  'SOC 2 Type II Compliant',
  'GDPR Compliant',
  '256-bit AES Encryption',
  'Regular Security Audits'
];

export function Security() {
  return (
    <section id="security" className="py-24 md:py-36 bg-secondary/30">
      <div className="container mx-auto px-6">
        <div className="text-center mb-20">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4 animate-fade-in">
            Security
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight animate-fade-in" style={{ animationDelay: '100ms' }}>
            Your data is safe with us
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto animate-fade-in" style={{ animationDelay: '200ms' }}>
            Security and privacy are built into everything we do
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-16">
          {securityFeatures.map((feature, index) => (
            <div
              key={feature.title}
              className="text-center p-8 rounded-2xl bg-card border border-border hover:border-primary/20 transition-all duration-300 animate-fade-in hover:-translate-y-1 hover:shadow-lg"
              style={{ animationDelay: `${300 + index * 100}ms` }}
            >
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-6">
                <feature.icon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Security checks */}
        <div className="flex flex-wrap justify-center gap-4 max-w-3xl mx-auto animate-fade-in" style={{ animationDelay: '600ms' }}>
          {securityChecks.map((check) => (
            <div
              key={check}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border"
            >
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">{check}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
