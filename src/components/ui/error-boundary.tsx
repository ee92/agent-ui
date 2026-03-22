import type { ReactNode } from "react";
import { Component } from "react";

type Props = {
  children: ReactNode;
  label: string;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch() {
    // Keep the fallback local to the section instead of crashing the full app.
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/8 p-4 text-sm text-rose-100">
          <p className="font-medium">{this.props.label} failed to render.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 rounded-lg border border-white/4 px-3 py-2 text-xs text-zinc-200"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
