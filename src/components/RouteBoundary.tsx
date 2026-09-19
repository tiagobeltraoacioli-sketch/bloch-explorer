// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A failed lazy chunk or an unexpected page exception must not take down the
 * explorer shell. Keeping the header and navigation alive gives the reader a
 * deterministic recovery path even during a partial deploy or stale cache.
 */
export class RouteBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Explorer route failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="container route-failure" role="alert">
        <div className="card route-failure-card">
          <span className="route-failure-kicker">Page interrupted</span>
          <h1 className="page-title">This view could not finish loading</h1>
          <p className="page-lede">
            The explorer shell is still available. Retry the current view to refresh its code and
            data, or return to the live chain overview.
          </p>
          <div className="route-failure-actions">
            <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
              Retry view
            </button>
            <a className="btn btn-ghost" href="/">Chain overview</a>
          </div>
          <details>
            <summary>Technical detail</summary>
            <code>{this.state.error.message || "Unknown rendering error"}</code>
          </details>
        </div>
      </div>
    );
  }
}
