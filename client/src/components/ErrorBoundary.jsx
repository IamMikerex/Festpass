import { Component } from 'react';

/** Last line of defence: a rendering error shows a recovery screen instead of a blank page. */
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
    console.error('FestPass UI error', error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#07050d', color: '#f5f3fb', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#a59fbb', marginBottom: 20 }}>This page hit an unexpected error. Your tickets and payments are safe. Reload to try again.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 20px', borderRadius: 12, border: 0, background: '#a855f7', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Reload page</button>
          <p style={{ marginTop: 16 }}><a href="/" style={{ color: '#c084fc' }}>Go to the home page</a></p>
        </div>
      </div>
    );
  }
}
