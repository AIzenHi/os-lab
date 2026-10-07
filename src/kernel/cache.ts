// 直接映射缓存模型(教学理想化):行 32B,写回+写分配
import { LINE_SIZE } from './isa';

export interface CacheLine {
  valid: boolean;
  dirty: boolean;
  block: number; // 块号 = 地址 / 32
  lastCycle: number;
}

export interface CacheAccessResult {
  hit: boolean;
  evictedBlock: number; // 被替换的块号(-1 表示无)
  dirtyEvict: boolean;
}

export class CacheModel {
  lines: CacheLine[];
  hits = 0;
  misses = 0;
  writebacks = 0;

  constructor(public size: number) {
    this.lines = Array.from({ length: size }, () => ({
      valid: false,
      dirty: false,
      block: -1,
      lastCycle: 0
    }));
  }

  occupancy(): number {
    return this.lines.reduce((n, l) => n + (l.valid ? 1 : 0), 0);
  }

  access(pa: number, write: boolean, cycle: number): CacheAccessResult {
    const block = Math.floor(pa / LINE_SIZE);
    const idx = block % this.size;
    const line = this.lines[idx];
    if (line.valid && line.block === block) {
      this.hits++;
      line.lastCycle = cycle;
      if (write) line.dirty = true;
      return { hit: true, evictedBlock: -1, dirtyEvict: false };
    }
    this.misses++;
    const res: CacheAccessResult = {
      hit: false,
      evictedBlock: line.valid ? line.block : -1,
      dirtyEvict: line.valid && line.dirty
    };
    if (res.dirtyEvict) this.writebacks++;
    this.lines[idx] = { valid: true, dirty: write, block, lastCycle: cycle };
    return res;
  }

  /** 释放页框时作废其中所有缓存行,返回作废数 */
  invalidatePFN(pfn: number): number {
    let n = 0;
    const lo = pfn * 8; // 每页 8 行
    for (const line of this.lines) {
      if (line.valid && line.block >= lo && line.block < lo + 8) {
        line.valid = false;
        line.dirty = false;
        n++;
      }
    }
    return n;
  }

  flush(): void {
    for (const line of this.lines) {
      line.valid = false;
      line.dirty = false;
    }
  }
}
