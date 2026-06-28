import { PageHero } from '@/components/app/PageHero';
import { LifeBuoy } from 'lucide-react';
import { HelpIssueForm } from '@/components/help/HelpIssueForm';
import { Card, CardContent } from '@/components/ui/card';

export default function Help() {
  return (
    <div className="page-shell">
      <div className="page-shell-sticky">
        <PageHero
          eyebrow="Knowledge Base"
          title="Help & Support"
          description="Stuck on something? Send your admin team an issue — we'll include the page you're on so they can help faster."
          accent="cyan"
          icon={<LifeBuoy className="w-5 h-5 text-white" strokeWidth={2} />}
        />
      </div>

      <div className="page-shell-content w-full animate-fade-in max-w-3xl">
        <Card>
          <CardContent className="p-6">
            <HelpIssueForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
