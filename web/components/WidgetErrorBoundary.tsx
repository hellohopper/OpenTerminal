"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../lib/use-i18n";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

function ErrorContent({ name, error, reset }: { name: string; error: Error; reset: () => void }) {
  const { t: ui } = useI18n();
  return <div className="p-2 flex flex-col gap-2 items-start">
    <span className="down">{name} {ui("failed to render:")} {error.message}</span>
    <button onClick={reset} className="dim hover:text-[var(--amber)]">{ui("Retry")}</button>
  </div>;
}

/**
 * Contains a render-time crash to the widget that threw, so one bad data point
 * from an upstream feed can't blank the whole terminal.
 */
export default class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] widget crashed:`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorContent name={this.props.name} error={error} reset={this.reset} />;
  }
}
