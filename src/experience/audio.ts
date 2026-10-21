export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  ambient: { nodes: AudioNode[]; gain: GainNode } | null = null;

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    this.ctx = ctx;
    const m = ctx.createGain();
    m.gain.value = 0.6;
    m.connect(ctx.destination);
    this.master = m;
    return ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, slide = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ctx.currentTime + dur);
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  hover() { this.tone(660, 0.08, 'sine', 0.08, 200); }
  click() { this.tone(220, 0.12, 'square', 0.15, -80); this.tone(440, 0.06, 'triangle', 0.1, 0); }
  whoosh() { this.tone(180, 0.6, 'sawtooth', 0.12, 600); }
  portal() { this.tone(120, 1.2, 'sine', 0.2, 400); this.tone(240, 1.2, 'sine', 0.15, 800); }
  returnSound() { this.tone(400, 0.5, 'sine', 0.12, -300); }

  startAmbient(world: string) {
    this.stopAmbient();
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 1.5);
    gain.connect(this.master);
    const nodes: AudioNode[] = [gain];

    const freqs: Record<string, number[]> = {
      galaxy: [55, 82.4, 110],
      ocean: [65.4, 98, 130.8],
      cyber: [73.4, 110, 146.8],
      forest: [82.4, 123.5, 164.8],
      lava: [49, 73.4, 98],
      hyperspace: [55, 110, 220],
      void: [61.7, 92.5, 123.5],
    };
    const f = freqs[world] || freqs.void;
    f.forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      // LFO
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.05 + i * 0.03;
      lfoGain.gain.value = 3;
      lfo.connect(lfoGain).connect(o.frequency);
      o.connect(g).connect(gain);
      o.start();
      lfo.start();
      nodes.push(o, lfo, g, lfoGain);
    });
    this.ambient = { nodes, gain };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const ctx = this.ctx;
    if (ctx) {
      this.ambient.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    }
    const a = this.ambient;
    setTimeout(() => {
      a.nodes.forEach(n => { try { (n as any).stop?.(); } catch {} try { n.disconnect(); } catch {} });
    }, 1100);
    this.ambient = null;
  }
}
