// MMU:TLB(8 项 LRU)与两级页表(4×4 项)
import type { PCB } from './types';

export interface PTE {
  present: boolean;
  dirty: boolean;
  pfn: number;
  diskBlock: number; // 后备磁盘块
}

export interface L2Table {
  frame: number; // 该二级页表占用的页框
  entries: (PTE | null)[]; // 4 项
}

export interface PageTable {
  l1Frame: number; // 一级页表页框
  l2: (L2Table | null)[]; // 4 组
}

export interface TLBEntry {
  valid: boolean;
  pid: number;
  vpn: number;
  pfn: number;
  lastCycle: number;
}

export const TLB_SIZE = 8;
export const PT_LEVELS = [4, 4]; // 一级 4 项 → 每项一个二级表 4 项 = 16 页

export function newPageTable(l1Frame: number): PageTable {
  return { l1Frame, l2: [null, null, null, null] };
}

export function getPTE(pt: PageTable, vpn: number): PTE | null {
  const l2 = pt.l2[vpn >> 2];
  if (!l2) return null;
  return l2.entries[vpn & 3] ?? null;
}

export function setPTE(pt: PageTable, vpn: number, pte: PTE, l2FrameAllocator: () => number): void {
  let l2 = pt.l2[vpn >> 2];
  if (!l2) {
    l2 = { frame: l2FrameAllocator(), entries: [null, null, null, null] };
    pt.l2[vpn >> 2] = l2;
  }
  l2.entries[vpn & 3] = pte;
}

export class TLB {
  entries: TLBEntry[] = Array.from({ length: TLB_SIZE }, () => ({
    valid: false,
    pid: -1,
    vpn: -1,
    pfn: -1,
    lastCycle: 0
  }));
  hits = 0;
  misses = 0;

  lookup(pid: number, vpn: number, cycle: number): number {
    for (const e of this.entries) {
      if (e.valid && e.pid === pid && e.vpn === vpn) {
        this.hits++;
        e.lastCycle = cycle;
        return e.pfn;
      }
    }
    this.misses++;
    return -1;
  }

  insert(pid: number, vpn: number, pfn: number, cycle: number): void {
    let victim = this.entries[0];
    for (const e of this.entries) {
      if (!e.valid) {
        victim = e;
        break;
      }
      if (e.lastCycle < victim.lastCycle) victim = e;
    }
    victim.valid = true;
    victim.pid = pid;
    victim.vpn = vpn;
    victim.pfn = pfn;
    victim.lastCycle = cycle;
  }

  flushPID(pid: number): void {
    for (const e of this.entries) if (e.pid === pid) e.valid = false;
  }

  invalidate(pid: number, vpn: number): void {
    for (const e of this.entries) {
      if (e.valid && e.pid === pid && e.vpn === vpn) e.valid = false;
    }
  }

  flushAll(): void {
    for (const e of this.entries) e.valid = false;
  }
}

/** 页表翻译(不含 TLB):返回 pfn,不存在映射返回 -1 */
export function walkTable(pt: PageTable, vpn: number): number {
  const pte = getPTE(pt, vpn);
  if (pte && pte.present) return pte.pfn;
  return -1;
}

/** 就绪进程的平均等待(供饥饿观测) */
export function maxReadyWait(procs: PCB[], cycle: number): number {
  let m = 0;
  for (const p of procs) {
    if (p.state === 'ready') m = Math.max(m, cycle - p.waitTime);
  }
  return m;
}
