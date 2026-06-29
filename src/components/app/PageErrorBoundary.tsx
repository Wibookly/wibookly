import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface State { error: Error | null; }

export class PageErrorBoundary extends React.Component<{ children: React.ReactNode; label?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the dev console so it appears in browser logs.
    // eslint-disable-next-line no-console
    console.error('[PageErrorBoundary]', this.props.label || '', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-2xl mx-auto my-12 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div className="space-y-2 min-w-0">
            <h2 className="text-base font-semibold">Something went wrong loading this page</h2>
            <p className="text-sm text-muted-foreground break-words">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reload page
              </Button>
              <Button size="sm" variant="ghost" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
