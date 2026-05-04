import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';

export default function ChatUpgrade() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-muted mx-auto flex items-center justify-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold">AI Chat not available in your tier</h1>
        <p className="text-muted-foreground">
          Contact your administrator to enable AI Chat for your account.
        </p>
        <div className="flex gap-2 justify-center pt-2">
          <Button asChild variant="outline">
            <Link to="/integrations">Back to app</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
