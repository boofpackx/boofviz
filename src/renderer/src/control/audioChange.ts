/**
 * Hears when the song changes in Spotify (a skip, a seek, a pause, the next
 * track starting) from the audio itself, and asks Spotify for the new position
 * straight away. Between those moments BOOFVIZ only checks every few seconds,
 * which keeps it well under Spotify's rate limit without a resync button.
 */
export class AudioChangeDetector {
  private silentSince: number | null = null;
  private silenceReported = false;
  private slow: number | null = null;
  private lastSync = -Infinity;
  private recent: number[] = [];

  constructor(
    private readonly cooldownMs = 1500,
    private readonly perMinute = 10,
  ) {}

  /** Feed one analysis frame; true when Spotify should be asked now. */
  update(nowMs: number, f: { silence: boolean; loudnessLUFS: number }, dtMs: number): boolean {
    let trigger = false;
    let resumed = false;
    if (f.silence) {
      this.silentSince ??= nowMs;
      // Silent for a moment: paused, or the song ended.
      if (!this.silenceReported && nowMs - this.silentSince > 700) {
        this.silenceReported = true;
        trigger = true;
      }
    } else {
      // Sound again after a gap: a new song, or playback resumed.
      if (this.silentSince !== null && nowMs - this.silentSince > 250) trigger = resumed = true;
      this.silentSince = null;
      this.silenceReported = false;
      const l = Number.isFinite(f.loudnessLUFS) ? f.loudnessLUFS : -70;
      if (this.slow === null) this.slow = l;
      // A sudden jump in loudness against the last few seconds: a skip or a seek.
      if (Math.abs(l - this.slow) > 10) {
        trigger = true;
        this.slow = l;
      }
      this.slow += (l - this.slow) * (1 - Math.exp(-dtMs / 3000));
    }
    if (!trigger) return false;
    this.recent = this.recent.filter((t) => nowMs - t < 60000);
    // Music coming back always counts (it's the moment the new position matters); others wait out a short cooldown.
    if ((!resumed && nowMs - this.lastSync < this.cooldownMs) || this.recent.length >= this.perMinute) return false;
    this.lastSync = nowMs;
    this.recent.push(nowMs);
    return true;
  }
}
