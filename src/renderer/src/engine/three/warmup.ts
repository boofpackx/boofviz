import type * as THREE from 'three';
import { createEffect, type Effect } from '../fx/effects';
import type { Generator } from '../generators/Generator';
import { createGenerator } from '../generators';
import { EFFECTS, GENERATORS } from '../registry';

/**
 * Compiles every generator and effect shader in the background, so the first
 * switch to a look never freezes on shader compilation (that can take whole
 * seconds on some Windows/ANGLE drivers, mid-show, on the downbeat).
 *
 * compileAsync uses KHR_parallel_shader_compile where available, so the
 * render loop keeps running meanwhile. One instance of each module stays
 * alive: three.js frees a program once nothing uses it, and these keep every
 * program cached for the real layers, whose materials share the same source.
 */
export class ShaderWarmup {
  private readonly keep: Array<Generator | Effect> = [];
  private stopped = false;

  /** Warm `first` (e.g. the kinds in the current look) before everything else. */
  async run(renderer: THREE.WebGLRenderer, first: string[] = []): Promise<void> {
    const kinds = [...new Set([...first, ...GENERATORS.map((g) => g.kind)])];
    for (const kind of kinds) {
      if (this.stopped) return;
      let gen: Generator;
      try {
        gen = createGenerator(kind);
      } catch {
        continue;
      }
      this.keep.push(gen);
      for (const t of gen.compileTargets?.() ?? []) await this.compile(renderer, t.scene, t.camera);
    }
    for (const def of EFFECTS) {
      if (this.stopped) return;
      const fx = createEffect(def.kind);
      if (!fx) continue;
      this.keep.push(fx);
      for (const pass of fx.compileTargets?.() ?? []) await this.compile(renderer, pass.scene, pass.camera);
    }
  }

  private async compile(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): Promise<void> {
    if (this.stopped) return;
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      // A shader that fails here fails (and is reported) again when it is used.
    }
    // Without the parallel-compile extension each compile blocks: spread them over frames.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  dispose(): void {
    this.stopped = true;
    for (const x of this.keep) x.dispose();
    this.keep.length = 0;
  }
}
