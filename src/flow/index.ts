// 流量编排:事件 → 粒子/音频/部件脉冲
import type { SimEvent } from '../kernel/types';
import { ParticlePool, type ParticleKind } from './particles';
import { kindAllowed, noteActivity, partsForEvent, pathForEvent, type FlowContext } from './paths';

export class FlowSystem {
  pool = new ParticlePool(320);
  private spawnBudget = 0;

  /** 每帧调用:处理事件(生成粒子、记录活跃度) */
  handleEvents(events: SimEvent[], ctx: FlowContext, now: number): void {
    const budget = ctx.reduced ? 6 : 26; // 每帧生成上限
    let used = 0;
    for (const ev of events) {
      for (const part of partsForEvent(ev)) noteActivity(part, now);
      if (used >= budget) continue;
      const spec = pathForEvent(ev, ctx);
      if (!spec) continue;
      if (!kindAllowed(spec.kind, ctx.view)) continue;
      const speed = ctx.reduced ? 4 : 7 + Math.min(6, spec.path.length * 0.6);
      if (this.pool.spawn(spec.kind, spec.path as number[][], speed)) used++;
    }
    this.spawnBudget = used;
  }

  step(dt: number): void {
    this.pool.step(dt);
  }

  clear(): void {
    this.pool.clear();
  }

  activeCount(): number {
    return this.pool.activeCount();
  }

  spawnedLastFrame(): number {
    return this.spawnBudget;
  }

  /** 供音频层使用的事件分类 */
  static audioRelevant(ev: SimEvent): string | null {
    switch (ev.kind) {
      case 'proc_create':
        return 'procLoad';
      case 'ifetch':
        return 'tick';
      case 'cache_hit':
        return 'cacheHit';
      case 'cache_miss':
        return 'cacheMiss';
      case 'page_fault':
        return 'pageFault';
      case 'ctx_load':
        return 'ctxSwitch';
      case 'int_timer':
      case 'int_disk':
      case 'int_kbd':
        return 'interrupt';
      case 'disk_read':
      case 'disk_write':
        return 'diskIO';
      case 'post_stage':
        return 'bootBeep';
      case 'checkpoint':
        return 'bootBeep';
      case 'shutdown_stage':
        return 'shutdownGlide';
      default:
        return null;
    }
  }
}

export const flow = new FlowSystem();
export type { ParticleKind };
