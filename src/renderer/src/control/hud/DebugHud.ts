import { BAND_NAMES, type AnalysisPacket, type AudioFrame } from '@shared/types/audio';

const LABELS: Record<string, string> = { sub: 'SUB', bass: 'BASS', lowMid: 'LMID', mid: 'MID', highMid: 'HMID', presence: 'PRES', air: 'AIR' };
const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';

/**
 * Debug HUD for the control-window preview only (never drawn in the output).
 * Spectrum, waveform, bands, beat/bar/phrase counters, BPM confidence and
 * onset flashes, drawn with Canvas2D over the preview.
 */
export class DebugHud {
  private readonly flash = { kick: 0, snare: 0, hat: 0, any: 0, drop: 0, downbeat: 0, phrase: 0 };

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, f: AudioFrame, p: AnalysisPacket | null, dt: number, fps: number): void {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.scale(dpr, dpr);
    const W = w / dpr;
    const H = h / dpr;
    const k = Math.exp(-dt / 0.18);
    this.flash.kick = f.onsets.kick ? 1 : this.flash.kick * k;
    this.flash.snare = f.onsets.snare ? 1 : this.flash.snare * k;
    this.flash.hat = f.onsets.hat ? 1 : this.flash.hat * k;
    this.flash.any = f.onsets.any ? 1 : this.flash.any * k;
    this.flash.drop = f.drop ? 1 : this.flash.drop * Math.exp(-dt / 1.5);
    this.flash.downbeat = f.isDownbeat ? 1 : this.flash.downbeat * k;
    this.flash.phrase = f.isPhraseStart ? 1 : this.flash.phrase * Math.exp(-dt / 0.5);

    this.drawTempo(ctx, 10, 10, f);
    this.drawOnsets(ctx, 10, 104, f, p);
    this.drawBands(ctx, W - 186, 10, f);
    this.drawStats(ctx, W - 186, 124, f, p, fps);
    this.drawSpectrum(ctx, 10, H - 92, W - 20, 82, f);
    ctx.restore();
  }

  private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = 'rgba(6,6,10,0.72)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
  }

  private drawTempo(ctx: CanvasRenderingContext2D, x: number, y: number, f: AudioFrame): void {
    this.panel(ctx, x, y, 236, 88);
    ctx.fillStyle = '#ececf2';
    ctx.font = `600 26px ${MONO}`;
    ctx.fillText(f.bpm.toFixed(1), x + 10, y + 32);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = '#9a9aaa';
    ctx.fillText(`BPM · ${f.tempoSource.toUpperCase()}`, x + 10, y + 46);

    // Confidence bar.
    ctx.fillStyle = '#22222b';
    ctx.fillRect(x + 10, y + 52, 96, 4);
    ctx.fillStyle = f.bpmConfidence > 0.5 ? '#3ddc84' : f.bpmConfidence > 0.25 ? '#ffb020' : '#ff4d4f';
    ctx.fillRect(x + 10, y + 52, 96 * Math.min(1, f.bpmConfidence), 4);

    // Bar.beat counter.
    const beatsInBar = f.beatsPerBar;
    const barBeat = Math.floor(f.barPhase * beatsInBar);
    const bar = Math.floor((f.beat - barBeat) / beatsInBar);
    ctx.fillStyle = '#c8c8d4';
    ctx.font = `600 14px ${MONO}`;
    ctx.fillText(`${bar + 1}.${barBeat + 1}`, x + 120, y + 28);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = '#6f6f7f';
    ctx.fillText(`beat ${f.beat.toFixed(2)}`, x + 120, y + 44);

    // Beat squares (current beat lit, downbeat flash).
    for (let i = 0; i < beatsInBar; i++) {
      const on = i === barBeat;
      const a = on ? 0.35 + 0.65 * (1 - f.beatPhase) : 0.12;
      ctx.fillStyle = i === 0 ? `rgba(255,46,136,${a})` : `rgba(57,213,255,${a})`;
      ctx.fillRect(x + 10 + i * 26, y + 62, 22, 8);
    }
    // Phrase progress.
    ctx.fillStyle = '#22222b';
    ctx.fillRect(x + 10, y + 76, 216, 4);
    ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * this.flash.phrase})`;
    ctx.fillRect(x + 10, y + 76, 216 * f.phrasePhase, 4);
    ctx.fillStyle = '#6f6f7f';
    ctx.fillText(`phrase ${f.beatsPerPhrase}`, x + 120, y + 70);
  }

  private drawOnsets(ctx: CanvasRenderingContext2D, x: number, y: number, f: AudioFrame, p: AnalysisPacket | null): void {
    this.panel(ctx, x, y, 236, 64);
    const items: Array<[string, number, string, number]> = [
      ['KICK', this.flash.kick, '255,46,136', p?.odfKick ?? 0],
      ['SNARE', this.flash.snare, '255,176,32', p?.odfSnare ?? 0],
      ['HAT', this.flash.hat, '57,213,255', p?.odfHat ?? 0],
      ['ANY', this.flash.any, '236,236,242', 0],
    ];
    ctx.font = `600 9px ${MONO}`;
    items.forEach(([label, a, rgb, odf], i) => {
      const bx = x + 10 + i * 56;
      ctx.fillStyle = `rgba(${rgb},${0.1 + 0.9 * a})`;
      ctx.fillRect(bx, y + 10, 50, 22);
      ctx.fillStyle = a > 0.5 ? '#08080a' : '#c8c8d4';
      ctx.fillText(label, bx + 6, y + 25);
      if (label !== 'ANY') {
        // Detection function relative to its adaptive threshold (tick = threshold).
        ctx.fillStyle = '#22222b';
        ctx.fillRect(bx, y + 38, 50, 3);
        ctx.fillStyle = `rgba(${rgb},0.9)`;
        ctx.fillRect(bx, y + 38, Math.min(50, 25 * odf), 3);
        ctx.fillStyle = '#ececf2';
        ctx.fillRect(bx + 25, y + 36, 1, 7);
      }
    });
    ctx.fillStyle = `rgba(255,46,136,${0.15 + 0.85 * this.flash.drop})`;
    ctx.fillRect(x + 10, y + 48, 106, 10);
    ctx.fillStyle = this.flash.drop > 0.5 ? '#08080a' : '#9a9aaa';
    ctx.fillText('DROP', x + 14, y + 56);
    ctx.fillStyle = f.silence ? 'rgba(255,77,79,0.85)' : 'rgba(61,220,132,0.25)';
    ctx.fillRect(x + 120, y + 48, 106, 10);
    ctx.fillStyle = f.silence ? '#08080a' : '#9a9aaa';
    ctx.fillText(f.silence ? 'SILENCE' : 'SIGNAL', x + 124, y + 56);
  }

  private drawBands(ctx: CanvasRenderingContext2D, x: number, y: number, f: AudioFrame): void {
    this.panel(ctx, x, y, 176, 106);
    ctx.font = `8px ${MONO}`;
    BAND_NAMES.forEach((name, i) => {
      const v = f.bands[name];
      const bx = x + 10 + i * 23;
      ctx.fillStyle = '#18181f';
      ctx.fillRect(bx, y + 10, 16, 70);
      const grad = ctx.createLinearGradient(0, y + 80, 0, y + 10);
      grad.addColorStop(0, '#3a0ca3');
      grad.addColorStop(0.6, '#f72585');
      grad.addColorStop(1, '#4cc9f0');
      ctx.fillStyle = grad;
      ctx.fillRect(bx, y + 80 - 70 * v, 16, 70 * v);
      ctx.fillStyle = '#9a9aaa';
      ctx.fillText(LABELS[name], bx - 1, y + 92);
      ctx.fillStyle = '#6f6f7f';
      ctx.fillText(v.toFixed(2).slice(1), bx + 1, y + 101);
    });
  }

  private drawStats(ctx: CanvasRenderingContext2D, x: number, y: number, f: AudioFrame, p: AnalysisPacket | null, fps: number): void {
    const rows: Array<[string, string]> = [
      ['RMS', f.rms.toFixed(3)],
      ['PEAK', f.peak.toFixed(3)],
      ['LUFS', f.loudnessLUFS <= -69 ? '—' : f.loudnessLUFS.toFixed(1)],
      ['ENERGY', `${f.energy.toFixed(2)} ${f.energyTrend === 'building' ? '▲' : f.energyTrend === 'dropping' ? '▼' : '■'}`],
      ['BRIGHT', f.brightness.toFixed(2)],
      ['FLUX', f.flux.toFixed(2)],
      ['WIDTH', `${f.stereo.width.toFixed(2)}  φ ${f.stereo.phase.toFixed(2)}`],
      ['INPUT', p ? `${p.inputLevelDb.toFixed(1)} dB` : '—'],
      ['GAIN', p ? `${(20 * Math.log10(p.appliedGain)).toFixed(1)} dB` : '—'],
      ['DELAY', p ? `${p.latencyMs.toFixed(0)} ms` : '—'],
      ['FPS', fps.toFixed(0)],
    ];
    this.panel(ctx, x, y, 176, 14 + rows.length * 13);
    ctx.font = `10px ${MONO}`;
    rows.forEach(([k, v], i) => {
      ctx.fillStyle = '#6f6f7f';
      ctx.fillText(k, x + 10, y + 18 + i * 13);
      ctx.fillStyle = '#c8c8d4';
      ctx.fillText(v, x + 66, y + 18 + i * 13);
    });
  }

  private drawSpectrum(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: AudioFrame): void {
    this.panel(ctx, x, y, w, h);
    const ix = x + 8;
    const iw = w - 16;
    const iy = y + 6;
    const ih = h - 12;
    // bands32 as faint columns.
    const bw = iw / 32;
    ctx.fillStyle = 'rgba(57,213,255,0.16)';
    for (let i = 0; i < 32; i++) {
      const v = f.bands32[i];
      ctx.fillRect(ix + i * bw + 1, iy + ih - ih * v, bw - 2, ih * v);
    }
    // 2048-bin log spectrum as a line.
    ctx.strokeStyle = '#ff2e88';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    const n = f.fft.length;
    const step = Math.max(1, Math.floor(n / iw));
    for (let i = 0; i < n; i += step) {
      const px = ix + (i / (n - 1)) * iw;
      const py = iy + ih - ih * f.fft[i];
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Waveform overlay.
    ctx.strokeStyle = 'rgba(236,236,242,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wv = f.waveform;
    for (let i = 0; i < wv.length; i += 2) {
      const px = ix + (i / (wv.length - 1)) * iw;
      const py = iy + ih * 0.5 - wv[i] * ih * 0.45;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Frequency labels.
    ctx.fillStyle = '#6f6f7f';
    ctx.font = `8px ${MONO}`;
    for (const [hz, label] of [
      [50, '50'],
      [200, '200'],
      [1000, '1k'],
      [5000, '5k'],
      [15000, '15k'],
    ] as Array<[number, string]>) {
      const px = ix + (Math.log(hz / 20) / Math.log(1000)) * iw;
      ctx.fillText(label, px, y + h - 3);
    }
  }
}
