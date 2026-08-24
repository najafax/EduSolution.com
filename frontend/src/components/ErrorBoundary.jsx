import { Component } from 'react';

// Nothing in this app previously caught a render-time crash anywhere —
// React's default behavior with no error boundary is to unmount the
// *entire* tree on an uncaught error, which is what turned one bad row of
// real data (a malformed date, an unexpected value from a historical CSV
// import — something a fresh empty/synthetic test database never
// reproduces) into a fully blank page with the sidebar and nav gone too,
// not just the one page that actually failed. Error boundaries can only be
// class components — there's no hook equivalent — so this is the one
// class component in an otherwise all-function-component codebase.
// Rendered once in App.jsx around the Suspense/Routes block, keyed by
// pathname there, so navigating to a different page — even a plain
// browser back — remounts this boundary and clears the crashed state.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">This page hit an error and couldn't load.</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Try reloading, or use the navigation to go somewhere else. If this keeps happening on the same page, let us know.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500"
        >
          Reload page
        </button>
      </div>
    );
  }
}
