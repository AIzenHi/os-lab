// 事件 → 粒子路径映射 + 部件活跃度记录(供 3D 发光脉冲)
import type { SimEvent } from '../kernel/types';
import { anchor, blockAnchor, busPort, frameAnchor, type Vec3 } from '../machine/parts';
import type { ParticleKind } from './particles';

export interface FlowContext {
  explode: number;
  framesTotal: number;
  view: 'data' | 'control' | 'heat' | 'writeback';
  reduced: boolean;
}

export interface SpawnSpec {
  kind: ParticleKind;
  path: Vec3[];
}

/** 部件活跃时间戳(渲染层读取做脉冲发光) */
const activity = new Map<string, number>();

export function noteActivity(part: string, now: number): void {
  activity.set(part, now);
}

export function partActivity(part: string, now: number): number {
  const t = activity.get(part);
  return t === undefined ? 0 : Math.max(0, 1 - (now - t) / 600); // 600ms 衰减
}

/** 两点连线(部件内部短程) */
function direct(a: Vec3, b: Vec3): Vec3[] {
  return [a, b];
}

/** 经总线布线:部件 → 汇入总线 → 沿总线 → 分流 → 部件 */
function viaBus(a: Vec3, b: Vec3): Vec3[] {
  const portA: Vec3 = [a[0], 0.78, a[2] * 0.25];
  const onA: Vec3 = busPort(a[0]);
  const onB: Vec3 = busPort(b[0]);
  const portB: Vec3 = [b[0], 0.78, b[2] * 0.25];
  return [a, portA, onA, onB, portB, b];
}

const LOWER: Record<string, string> = { l1i: 'l2', l1d: 'l2', l2: 'l3', l3: 'dram' };

/** 事件 → 粒子生成规格;返回 null 表示该事件不产生粒子 */
export function pathForEvent(ev: SimEvent, ctx: FlowContext): SpawnSpec | null {
  const a = (k: string): Vec3 => anchor(k, ctx.explode);
  const frame = (pfn: number | undefined): Vec3 =>
    pfn === undefined ? a('dram') : frameAnchor(pfn, ctx.framesTotal, ctx.explode);
  const block = (b: number | undefined): Vec3 =>
    b === undefined ? a('disk') : blockAnchor(b, ctx.explode);

  switch (ev.kind) {
    case 'ifetch':
      return { kind: 'instr', path: direct(a('l1i'), a('cpu_if')) };
    case 'cache_hit':
      return {
        kind: 'data',
        path: direct(a(ev.level === 'l1i' ? 'l1i' : ev.level === 'l1d' ? 'l1d' : ev.level ?? 'l1d'), a('cpu_mem'))
      };
    case 'cache_miss':
      return {
        kind: 'data',
        path: direct(a('cpu_mem'), a(ev.level === 'l1i' ? 'l1i' : ev.level === 'l1d' ? 'l1d' : ev.level ?? 'l1d'))
      };
    case 'cache_fill': {
      const target = ev.level === 'l1i' ? 'l1i' : ev.level === 'l1d' ? 'l1d' : (ev.level as string);
      const src = LOWER[target] ?? 'dram';
      return { kind: 'data', path: [a(src), a(target), a('cpu_mem')] };
    }
    case 'cache_writeback':
      return { kind: 'writeback', path: viaBus(a('l3'), frame(Math.floor((ev.pa ?? 0) / 256))) };
    case 'tlb_hit':
      return { kind: 'data', path: direct(a('tlb'), a('cpu_mem')) };
    case 'tlb_miss':
      return { kind: 'data', path: direct(a('cpu_mem'), a('tlb')) };
    case 'pt_walk':
      return { kind: 'data', path: [a('cpu_mem'), a('tlb'), a('mmu'), a('dram'), a('tlb')] };
    case 'page_fault':
      return { kind: 'ctrl', path: [a('cpu_mem'), a('gate'), a('tlb')] };
    case 'fault_evict':
      return { kind: 'writeback', path: viaBus(frame(ev.pfn), a('disk')) };
    case 'fault_writeback':
      return { kind: 'writeback', path: viaBus(frame(ev.pfn), block(ev.num)) };
    case 'fault_read':
      return { kind: 'data', path: viaBus(block(ev.num), frame(ev.pfn)) };
    case 'fault_done':
      return { kind: 'data', path: [frame(ev.pfn), a('tlb'), a('cpu_mem')] };
    case 'disk_read':
      return { kind: 'data', path: viaBus(block(ev.num), frame(ev.pfn)) };
    case 'disk_write':
      return { kind: 'writeback', path: viaBus(frame(ev.pfn), block(ev.num)) };
    case 'dma_start':
      return { kind: 'data', path: direct(a('io'), frame(ev.pfn)) };
    case 'bus_transfer':
      return { kind: 'data', path: direct(a('io'), frame(ev.pfn)) };
    case 'int_timer':
      return { kind: 'ctrl', path: [a('clock'), a('pic'), a('cpu_intpin')] };
    case 'int_disk':
      return { kind: 'ctrl', path: [a('io'), a('pic'), a('cpu_intpin')] };
    case 'int_kbd':
      return { kind: 'ctrl', path: [a('pic'), a('cpu_intpin')] };
    case 'isr_enter':
      return { kind: 'ctrl', path: direct(a('pic'), a('cpu_intpin')) };
    case 'syscall_enter':
      return { kind: 'ctrl', path: [a('cpu_ex'), a('gate'), a('ivt')] };
    case 'syscall_exit':
      return { kind: 'ctrl', path: direct(a('gate'), a('cpu_ex')) };
    case 'sched_pick':
      return { kind: 'ctrl', path: direct(a('sched'), a('cpu')) };
    case 'ctx_save':
      return { kind: 'writeback', path: viaBus(a('cpu_regs'), a('pcb')) };
    case 'ctx_load':
      return { kind: 'ctrl', path: viaBus(a('pcb'), a('cpu_regs')) };
    case 'proc_create':
      return { kind: 'ctrl', path: viaBus(a('disk'), a('pcb')) };
    case 'proc_ready':
      return { kind: 'ctrl', path: direct(a('pcb'), a('sched')) };
    case 'proc_wake':
      return { kind: 'ctrl', path: direct(a('pcb'), a('sched')) };
    case 'proc_block':
      return { kind: 'ctrl', path: direct(a('cpu'), a('pcb')) };
    case 'proc_exit':
      return { kind: 'writeback', path: viaBus(a('pcb'), a('disk')) };
    case 'frame_alloc':
      return { kind: 'ctrl', path: viaBus(a('sched'), frame(ev.pfn)) };
    case 'frame_free':
      return { kind: 'writeback', path: viaBus(frame(ev.pfn), a('sched')) };
    case 'sem_p':
    case 'sem_v':
      return { kind: 'ctrl', path: direct(a('cpu'), a('sem')) };
    case 'sem_block':
      return { kind: 'ctrl', path: direct(a('sem'), a('pcb')) };
    case 'sem_wake':
      return { kind: 'ctrl', path: direct(a('sem'), a('pcb')) };
    case 'quantum_end':
      return { kind: 'ctrl', path: [a('clock'), a('cpu_intpin')] };
    case 'power_on':
      return { kind: 'ctrl', path: direct(a('psu'), a('board')) };
    case 'post_stage':
      return { kind: 'ctrl', path: direct(a('psu'), a('cpu')) };
    case 'bootloader':
    case 'kernel_load':
      return { kind: 'data', path: viaBus(block(ev.num), frame(ev.pfn ?? 0)) };
    case 'kinit':
      return { kind: 'ctrl', path: direct(a('dram'), a('ivt')) };
    case 'boot_done':
      return { kind: 'ctrl', path: direct(a('ivt'), a('cpu')) };
    case 'checkpoint':
      return { kind: 'writeback', path: viaBus(frame(7), block(ev.num)) };
    case 'branch_flush':
      return { kind: 'instr', path: direct(a('cpu_ex'), a('cpu_if')) };
    default:
      return null;
  }
}

/** 视图模式对应的粒子类别过滤 */
export function kindAllowed(kind: ParticleKind, view: FlowContext['view']): boolean {
  switch (view) {
    case 'data':
      return kind === 'data' || kind === 'instr';
    case 'control':
      return kind === 'ctrl';
    case 'writeback':
      return kind === 'writeback';
    case 'heat':
      return false;
    default:
      return false;
  }
}

/** 事件对应的活跃部件(用于 3D 脉冲) */
export function partsForEvent(ev: SimEvent): string[] {
  switch (ev.kind) {
    case 'ifetch':
      return ['l1i', 'cpu'];
    case 'cache_hit':
    case 'cache_miss':
    case 'cache_fill':
      return [ev.level === 'l1i' ? 'l1i' : ev.level === 'l1d' ? 'l1d' : (ev.level as string), 'cpu'];
    case 'cache_writeback':
      return ['l3', 'dram'];
    case 'tlb_hit':
    case 'tlb_miss':
    case 'pt_walk':
      return ['tlb'];
    case 'page_fault':
    case 'fault_read':
    case 'fault_done':
      return ['tlb', 'dram', 'disk', 'bus'];
    case 'fault_evict':
    case 'fault_writeback':
      return ['dram', 'disk', 'bus'];
    case 'disk_read':
    case 'disk_write':
    case 'dma_start':
    case 'dma_done':
    case 'bus_transfer':
      return ['disk', 'io', 'bus'];
    case 'int_timer':
      return ['clock', 'pic'];
    case 'int_disk':
      return ['io', 'pic'];
    case 'int_kbd':
    case 'isr_enter':
      return ['pic', 'cpu'];
    case 'syscall_enter':
    case 'syscall_exit':
      return ['gate', 'ivt'];
    case 'sched_pick':
      return ['sched'];
    case 'ctx_save':
    case 'ctx_load':
      return ['pcb', 'cpu'];
    case 'proc_create':
      return ['disk', 'pcb'];
    case 'proc_ready':
    case 'proc_wake':
      return ['pcb', 'sched'];
    case 'proc_exit':
      return ['pcb', 'disk'];
    case 'frame_alloc':
    case 'frame_free':
      return ['dram'];
    case 'sem_p':
    case 'sem_v':
    case 'sem_block':
    case 'sem_wake':
      return ['sem'];
    case 'power_on':
    case 'post_stage':
      return ['psu', 'cpu'];
    case 'bootloader':
    case 'kernel_load':
      return ['disk', 'io', 'dram', 'bus'];
    case 'kinit':
      return ['ivt', 'dram'];
    case 'boot_done':
      return ['ivt', 'cpu'];
    case 'checkpoint':
      return ['dram', 'disk'];
    case 'quantum_end':
      return ['clock', 'cpu'];
    default:
      return [];
  }
}
