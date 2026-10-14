import { Component, type ReactNode } from 'react';
import i18n from '@/i18n';
import { reportError } from '@/features/monitoring';

/**
 * Shows a friendly recovery screen instead of a blank page if a screen crashes. Records are never lost:
 * they are saved as they are entered. Passing `resetKey` (the current route) clears the error when the
 * user navigates, so one failed screen never blocks the rest of the app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('Kopor screen error:', error); reportError(error); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="shell"><div className="content" style={{ paddingTop: '20vh', textAlign: 'center', alignItems: 'center' }}>
        <div className="boot-logo">K</div>
        <h1 style={{ fontSize: 20 }}>{i18n.t('crash.title')}</h1>
        <p className="muted">{i18n.t('crash.text')}</p>
        <button className="btn primary" onClick={() => location.reload()}>{i18n.t('crash.reload')}</button>
      </div></div>
    );
  }
}
