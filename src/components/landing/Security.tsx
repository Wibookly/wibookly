import { Shield, Key, Lock } from 'lucide-react';

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

export function Security() {
  return (
    <section id="security" className="py-20 md:py-32 bg-secondary/30">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Security & Privacy
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Your data security is our top priority
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {securityFeatures.map((feature, index) => (
            <div
              key={feature.title}
              className="text-center p-6"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-secondary mb-4">
                <feature.icon className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
