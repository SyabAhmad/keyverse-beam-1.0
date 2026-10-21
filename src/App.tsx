import { useEffect, useRef, useState } from 'react';
import { Experience } from './experience/Experience';
import type { AppState } from './experience/Experience';
import './App.css';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const expRef = useRef<Experience | null>(null);
  const [state, setState] = useState<AppState>('loading');
  const [world, setWorld] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [hoverKey, setHoverKey] = useState<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const exp = new Experience(containerRef.current);
    expRef.current = exp;
    exp.onStateChange = (s, w) => {
      setState(s);
      setWorld(w);
    };
    exp.onHoverLabel = (k) => setHoverKey(k);

    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      exp.update(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      exp.dispose();
    };
  }, []);

  const handleMute = () => {
    const exp = expRef.current;
    if (!exp) return;
    exp.audio.ensure();
    const next = !muted;
    setMuted(next);
    exp.audio.setMuted(next);
  };

  const handleReturn = () => {
    expRef.current?.startTransitionOut();
  };

  return (
    <div className="app">
      <div ref={containerRef} className="canvas-container" />
      {(state === 'loading' || state === 'intro' || state === 'ready') && (
        <div className="title-overlay">
          <h1 className="title">KEYVERSE</h1>
          <p className="subtitle">Every key opens a different universe.</p>
          {state === 'ready' && <p className="instruction">Choose a key to explore.</p>}
        </div>
      )}
      {state === 'ready' && hoverKey && (
        <div className="hover-hint">{hoverKey.label}</div>
      )}
      {state === 'world' && (
        <div className="world-ui">
          <button className="return-btn" onClick={handleReturn}>Return to Keyboard</button>
        </div>
      )}
      <button className="mute-btn" onClick={handleMute} aria-label="mute">
        {muted ? '\u{1F507}' : '\u{1F50A}'}
      </button>
    </div>
  );
}

export default App;
