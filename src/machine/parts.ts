// 3D 部件布局:锚点 / 爆炸向量 / 镜头预设 / 阶段-部件-指标关联
import type { Phase } from '../kernel/types';

export type Vec3 = [number, number, number];

export const BOARD = { w: 44, d: 28, h: 0.4 };
export const BUS_X = 17;

/** 部件基础位置(世界坐标,y 为部件顶面高度) */
export const PART_POS: Record<string, Vec3> = {
  // CPU 封装(中心 -9,0)
  cpu: [-9, 0.9, 0],
  cpu_if: [-11.4, 1.0, -2.0],
  cpu_id: [-10.2, 1.0, -2.0],
  cpu_ex: [-9.0, 1.0, -2.0],
  cpu_mem: [-7.8, 1.0, -2.0],
  cpu_wb: [-6.6, 1.0, -2.0],
  cpu_regs: [-9, 1.0, -0.4],
  cpu_pc: [-11.7, 1.0, 0.6],
  cpu_intpin: [-9, 1.5, 2.8],
  l1i: [-11.4, 0.9, 1.8],
  l1d: [-10.2, 0.9, 1.8],
  tlb: [-6.6, 0.9, 0.6],
  mmu: [-6.6, 0.9, 1.8],
  l2: [-9.0, 0.9, 1.8],
  l3: [-7.8, 0.9, 1.8],
  // 内存
  dram: [3.5, 2.5, -8.5],
  dram2: [7.5, 2.5, -8.5],
  pt: [7.5, 4.2, -8.5],
  // 存储 / I/O
  disk: [14.5, 1.2, 4.5],
  io: [9, 0.7, 3.5],
  // 控制
  pic: [-3, 0.7, 3],
  clock: [-13, 0.6, 2.5],
  psu: [-18, 1.5, 5],
  // 内核区
  sched: [-13.5, 1.0, -9.8],
  pcb: [-16.5, 2.0, -6.5],
  ivt: [-12.5, 1.0, -6.2],
  sem: [-10.8, 1.0, -9.3],
  gate: [-8.5, 2.2, -4.0],
  board: [0, 0.2, 0]
};

/** 爆炸方向与距离 */
export const EXPLODE: Record<string, { dir: Vec3; dist: number }> = {
  cpu: { dir: [0, 1, 0], dist: 2.6 },
  cpu_if: { dir: [0, 1, 0], dist: 2.2 },
  cpu_id: { dir: [0, 1, 0], dist: 2.2 },
  cpu_ex: { dir: [0, 1, 0], dist: 2.2 },
  cpu_mem: { dir: [0, 1, 0], dist: 2.2 },
  cpu_wb: { dir: [0, 1, 0], dist: 2.2 },
  cpu_regs: { dir: [0, 1, 0], dist: 1.8 },
  cpu_pc: { dir: [0, 1, 0], dist: 1.6 },
  cpu_intpin: { dir: [0, 1, 0], dist: 1.7 },
  l1i: { dir: [0, 1, 0], dist: 1.3 },
  l1d: { dir: [0, 1, 0], dist: 1.3 },
  tlb: { dir: [0, 1, 0], dist: 1.9 },
  mmu: { dir: [0, 1, 0], dist: 1.9 },
  l2: { dir: [0, 1, 0], dist: 0.9 },
  l3: { dir: [0, 1, 0], dist: 1.1 },
  dram: { dir: [0, 1, -0.35], dist: 2.4 },
  dram2: { dir: [0, 1, -0.35], dist: 2.4 },
  pt: { dir: [0, 1, -0.5], dist: 3.4 },
  disk: { dir: [0, 1, 0.4], dist: 2.2 },
  io: { dir: [0, 1, 0.3], dist: 1.6 },
  pic: { dir: [0, 1, 0.3], dist: 1.6 },
  clock: { dir: [0, 1, 0.3], dist: 1.4 },
  psu: { dir: [-0.3, 1, 0.3], dist: 1.8 },
  sched: { dir: [0, 1, -0.3], dist: 1.8 },
  pcb: { dir: [0, 1, -0.3], dist: 2.6 },
  ivt: { dir: [0, 1, -0.3], dist: 1.8 },
  sem: { dir: [0, 1, -0.3], dist: 1.5 },
  gate: { dir: [0, 1, -0.2], dist: 2.2 },
  board: { dir: [0, -1, 0], dist: 0.8 }
};

/** 计算部件在给定爆炸系数下的世界坐标 */
export function anchor(key: string, explode: number): Vec3 {
  const base = PART_POS[key] ?? [0, 0, 0];
  const e = EXPLODE[key];
  if (!e || explode <= 0) return base;
  const f = explode * e.dist;
  return [base[0] + e.dir[0] * f, base[1] + e.dir[1] * f, base[2] + e.dir[2] * f];
}

/** 总线接入点 */
export function busPort(x: number): Vec3 {
  return [x, 0.75, 0];
}

/** 物理页框 → 内存颗粒上的单元格位置(两根 DIMM,每根 4×6) */
export function frameAnchor(pfn: number, framesTotal: number, explode: number): Vec3 {
  const perDimm = Math.max(1, Math.ceil(framesTotal / 2));
  const dimm = Math.min(1, Math.floor(pfn / perDimm));
  const idx = pfn - dimm * perDimm;
  const cols = 4;
  const rows = Math.max(1, Math.ceil(perDimm / cols));
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const base = dimm === 0 ? PART_POS.dram : PART_POS.dram2;
  const e = EXPLODE.dram;
  const f = explode * e.dist;
  const x = base[0] + e.dir[0] * f;
  const y = base[1] + e.dir[1] * f;
  const z = base[2] + e.dir[2] * f;
  const cw = 0.55;
  const ch = 0.72;
  const gridH = rows * ch;
  return [x + dimm * 0, y + (row - (rows - 1) / 2) * ch - gridH * 0.0, z + (col - (cols - 1) / 2) * cw - 0.9];
}

/** 磁盘块 → 存储顶面网格位置(16×8) */
export function blockAnchor(block: number, explode: number): Vec3 {
  const cols = 16;
  const col = block % cols;
  const row = Math.floor(block / cols);
  const base = PART_POS.disk;
  const e = EXPLODE.disk;
  const f = explode * e.dist;
  return [
    base[0] + e.dir[0] * f + (col - 7.5) * 0.26,
    base[1] + e.dir[1] * f + 0.05,
    base[2] + e.dir[2] * f + (row - 3.5) * 0.4
  ];
}

/** 就绪队列槽位 */
export function queueSlot(i: number, explode: number): Vec3 {
  const base = PART_POS.sched;
  const e = EXPLODE.sched;
  const f = explode * e.dist;
  return [base[0] + e.dir[0] * f + i * 1.05 - 2.1, base[1] + e.dir[1] * f, base[2] + e.dir[2] * f];
}

export const CAMERA_PRESETS: Record<string, { pos: Vec3; target: Vec3 }> = {
  global: { pos: [15, 21, 27], target: [0, 0.5, -1] },
  exec: { pos: [-9, 6.5, 6.0], target: [-9, 1.4, -0.4] },
  mem: { pos: [-3.5, 9.5, 6.5], target: [0.5, 1.0, -4.5] },
  sched: { pos: [-13.5, 7.5, -1.0], target: [-13.5, 1.2, -8.0] },
  free: { pos: [15, 21, 27], target: [0, 0.5, -1] }
};

/** 阶段 → 高亮部件 */
export const PHASE_PARTS: Record<Phase, string[]> = {
  idle: ['psu'],
  boot: ['psu', 'clock', 'disk', 'dram', 'bus', 'ivt'],
  load: ['disk', 'io', 'bus', 'pcb', 'sched'],
  ready: ['sched', 'pcb'],
  exec: ['cpu', 'l1i', 'l1d', 'cpu_regs', 'cpu_pc'],
  mem: ['cpu', 'tlb', 'l1d', 'l2', 'l3', 'dram', 'bus'],
  io: ['io', 'disk', 'bus', 'dram'],
  ctx: ['pcb', 'cpu', 'sched'],
  intr: ['pic', 'ivt', 'gate', 'cpu', 'clock'],
  halt: ['psu', 'clock', 'bus', 'disk']
};

/** 部件 → 关联指标键 */
export const PART_METRICS: Record<string, string[]> = {
  cpu: ['cpuUtil', 'instructions'],
  l1i: ['cacheHit'],
  l1d: ['cacheHit'],
  l2: ['cacheHit'],
  l3: ['cacheHit'],
  tlb: ['faultRate'],
  dram: ['memUsage', 'faultRate'],
  bus: ['cpuUtil'],
  disk: ['throughput'],
  pic: ['cpuUtil'],
  clock: ['cpuUtil'],
  sched: ['ctxSwitches', 'throughput'],
  pcb: ['avgTurnaround'],
  gate: ['instructions'],
  ivt: ['instructions'],
  sem: ['ctxSwitches'],
  io: ['throughput'],
  psu: [],
  board: []
};

/** 部件 → 关联阶段 */
export const PART_PHASES: Record<string, Phase[]> = {
  cpu: ['exec', 'mem', 'ctx', 'intr'],
  l1i: ['exec'],
  l1d: ['mem'],
  l2: ['mem'],
  l3: ['mem'],
  tlb: ['mem'],
  dram: ['mem', 'io'],
  bus: ['boot', 'load', 'mem', 'io'],
  disk: ['boot', 'load', 'io', 'mem'],
  pic: ['intr'],
  clock: ['boot', 'intr', 'halt'],
  sched: ['ready', 'ctx'],
  pcb: ['load', 'ctx'],
  gate: ['intr'],
  ivt: ['boot', 'intr'],
  sem: ['intr'],
  io: ['boot', 'load', 'io'],
  psu: ['idle', 'boot', 'halt'],
  board: []
};

/** 部件 → 铭牌 i18n 键 */
export const PART_LABEL: Record<string, string> = {
  cpu: 'part_cpu',
  l1i: 'part_l1i',
  l1d: 'part_l1d',
  l2: 'part_l2',
  l3: 'part_l3',
  tlb: 'part_tlb',
  dram: 'part_dram',
  bus: 'part_bus',
  disk: 'part_disk',
  pic: 'part_pic',
  clock: 'part_clock',
  sched: 'part_sched',
  pcb: 'part_pcb',
  gate: 'part_gate',
  ivt: 'part_ivt',
  sem: 'part_sem',
  board: 'part_board',
  io: 'part_io',
  psu: 'part_psu'
};
