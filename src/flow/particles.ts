// 池化粒子系统:纯数学实现(与渲染层解耦,便于测试)
export type ParticleKind = 'data' | 'instr' | 'ctrl' | 'writeback';

export interface Particle {
  active: boolean;
  kind: ParticleKind;
  path: number[]; // 扁平 [x,y,z, x,y,z, ...]
  seg: number;
  t: number; // 当前段内进度 0..1
  speed: number; // 单位/秒
  segLen: number;
  pos: [number, number, number];
}

/** path 扁平数组中从偏移 s 开始的线段长度 */
export function segDist(path: number[], s: number): number {
  return Math.hypot(path[s + 3] - path[s], path[s + 4] - path[s + 1], path[s + 5] - path[s + 2]);
}

export class ParticlePool {
  particles: Particle[] = [];

  constructor(public capacity = 320) {
    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        active: false,
        kind: 'data',
        path: [],
        seg: 0,
        t: 0,
        speed: 6,
        segLen: 0,
        pos: [0, 0, 0]
      });
    }
  }

  activeCount(): number {
    return this.particles.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }

  spawn(kind: ParticleKind, path: number[][], speed: number): boolean {
    if (path.length < 2) return false;
    const p = this.particles.find((q) => !q.active);
    if (!p) return false; // 池满,丢弃(节流由上游负责)
    p.active = true;
    p.kind = kind;
    p.path = path.flat();
    p.seg = 0;
    p.t = 0;
    p.speed = speed;
    p.segLen = Math.max(0.0001, segDist(p.path, 0));
    p.pos = [p.path[0], p.path[1], p.path[2]];
    return true;
  }

  step(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      let move = p.speed * dt;
      while (move > 0) {
        const remain = p.segLen * (1 - p.t);
        if (move < remain) {
          p.t += move / p.segLen;
          move = 0;
        } else {
          move -= remain;
          p.seg++;
          const start = p.seg * 3;
          if (start + 3 >= p.path.length) {
            p.active = false; // 抵达终点,回收
            break;
          }
          p.segLen = Math.max(0.0001, segDist(p.path, start));
          p.t = 0;
        }
      }
      if (!p.active) continue;
      const a = p.seg * 3;
      const b = a + 3;
      p.pos[0] = p.path[a] + (p.path[b] - p.path[a]) * p.t;
      p.pos[1] = p.path[a + 1] + (p.path[b + 1] - p.path[a + 1]) * p.t;
      p.pos[2] = p.path[a + 2] + (p.path[b + 2] - p.path[a + 2]) * p.t;
    }
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
  }
}
