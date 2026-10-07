// 确定性离散事件模拟内核:整机运行状态机
// 一切粒子、指标、图表、3D 部件状态均由此驱动
import { buildProgram, CODE_PAGE, PAGE_SIZE, instrText, type Instr, type SysName } from './isa';
import { CacheModel } from './cache';
import { FileSystem } from './fs';
import { TLB, getPTE, newPageTable, setPTE, type PageTable, type PTE } from './mmu';
import {
  CTX_SWITCH_COST,
  ISR_DISK_CYCLES,
  ISR_KBD_CYCLES,
  ISR_TIMER_CYCLES,
  TIMER_PERIOD,
  detectDeadlock,
  pickNext,
  shouldPreemptPrio
} from './scheduler';
import { mulberry32, type RNG } from './rng';
import type {
  EvKind,
  PCB,
  Phase,
  ProcRole,
  SimConfig,
  SimEvent,
  TimelineEntry,
  TlKind
} from './types';

export const KERNEL_FRAMES = 8; // 0..7 内核保留:引导/内核/IVT/栈/缓冲
export const CYCLES_PER_SEC = 60;
export const PTWALK_CYCLES = 6;
export const L2_CYCLES = 4;
export const L3_CYCLES = 10;
export const DRAM_CYCLES = 26;
export const DMA_CYCLES = 120;
export const MAX_PROCS = 6;

export const DEFAULT_CONFIG: SimConfig = {
  algo: 'rr',
  quantum: 800,
  l1Lines: 16,
  frames: 48,
  speed: 1,
  seed: 20260829
};

export type FrameState = 'free' | 'kernel' | 'user';
export type PartId =
  | 'cpu'
  | 'l1i'
  | 'l1d'
  | 'l2'
  | 'l3'
  | 'tlb'
  | 'dram'
  | 'bus'
  | 'disk'
  | 'pic'
  | 'sched'
  | 'gate';

export type SimSnapshot = ReturnType<Sim['snapshot']>;

interface PipeCell {
  pid: number;
  pc: number;
  instr: Instr;
  traced: boolean;
  destReg: number; // -1 = 无寄存器写回
  result: number;
  va: number;
  storeVal: number;
}

interface MemTx {
  kind: 'load' | 'store' | 'ifetch';
  pid: number;
  pc: number;
  va: number;
  write: boolean;
  step: 'tlb' | 'ptwalk' | 'l1' | 'l2' | 'l3' | 'dram';
  remaining: number;
  pa: number;
  cell: PipeCell | null;
  traced: boolean;
}

interface KernelTask {
  kind:
    | 'isr-timer'
    | 'isr-disk'
    | 'isr-kbd'
    | 'syscall'
    | 'fault'
    | 'switch'
    | 'loader'
    | 'shutdown';
  cyclesLeft: number;
  data: {
    sys?: SysName;
    pid?: number;
    vpn?: number;
    from?: number;
    to?: number;
    role?: ProcRole;
    prio?: number;
    sub?: string;
    progress?: number;
  };
}

interface DmaJob {
  id: number;
  kind: 'read' | 'write';
  block: number;
  frame: number;
  tag: {
    type: 'evict' | 'pagein' | 'io' | 'boot' | 'checkpoint';
    pid?: number;
    vpn?: number;
    ownerPid?: number;
    ownerVpn?: number;
    wake?: number;
  };
}

interface Semaphore {
  id: 0 | 1;
  value: number;
  owner: number;
  waiters: number[];
}

export interface TraceStep {
  key: string;
  t: number;
  pid?: number;
  num?: number;
  vpn?: number;
  sys?: string;
}

const BOOT_PLAN: { stage: string; cycles: number; block: number; frame: number }[] = [
  { stage: 'post-cpu', cycles: 60, block: -1, frame: -1 },
  { stage: 'post-mem', cycles: 100, block: -1, frame: -1 },
  { stage: 'post-dev', cycles: 60, block: -1, frame: -1 },
  { stage: 'bootloader', cycles: 0, block: 0, frame: 0 },
  { stage: 'kernel-1', cycles: 0, block: 1, frame: 1 },
  { stage: 'kernel-2', cycles: 0, block: 2, frame: 2 },
  { stage: 'kernel-3', cycles: 0, block: 3, frame: 3 },
  { stage: 'kinit-pt', cycles: 40, block: -1, frame: -1 },
  { stage: 'kinit-ivt', cycles: 40, block: -1, frame: -1 },
  { stage: 'kinit-dev', cycles: 40, block: -1, frame: -1 }
];

export class Sim {
  cfg: SimConfig;
  rng: RNG;
  cycle = 0;
  power = false;
  suspended = false;
  phase: Phase = 'idle';
  freq = 0;
  temp = 22;
  deadlockFlag = false;

  bootStage = 'off';
  bootIdx = 0;
  bootLeft = 0;

  shutdown: { stage: string; cap: number } | null = null;

  cpuMode: 'user' | 'kernel' = 'user';
  kernelTask: KernelTask | null = null;
  regs: number[] = new Array(8).fill(0);
  pc = 0;
  pipeIf: PipeCell | null = null;
  pipeId: PipeCell | null = null;
  pipeEx: PipeCell | null = null;
  pipeMem: PipeCell | null = null;
  pipeWb: PipeCell | null = null;
  memTx: MemTx | null = null;
  ifTx: MemTx | null = null;
  trapPending: { kind: 'sys' | 'fault'; sys?: SysName; pid: number; vpn?: number } | null = null;
  quantumUsed = 0;

  l1i!: CacheModel;
  l1d!: CacheModel;
  l2!: CacheModel;
  l3!: CacheModel;
  tlb = new TLB();

  frames: { state: FrameState; pid: number; dirty: boolean }[] = [];
  frameLastUse: number[] = [];
  frameMap: ({ pid: number; vpn: number } | null)[] = [];
  framePending: boolean[] = []; // 换入中的帧不可作为牺牲者

  fs = new FileSystem();
  pic = { timer: false, disk: false, kbd: false };
  clockEnabled = false;
  busEnabled = false;
  nextTimerAt = 0;
  dmaQueue: DmaJob[] = [];
  dmaActive: DmaJob | null = null;
  dmaLeft = 0;
  dmaNextId = 1;
  completedDma: DmaJob | null = null;

  procs: PCB[] = [];
  readyQueue: number[] = [];
  currentPid: number | null = null;
  nextPid = 1;
  pendingSpawns: { role: ProcRole; prio?: number }[] = [];
  programs = new Map<number, Instr[]>();
  pageTables = new Map<number, PageTable>();
  sems: Semaphore[] = [
    { id: 0, value: 1, owner: -1, waiters: [] },
    { id: 1, value: 1, owner: -1, waiters: [] }
  ];

  events: SimEvent[] = [];
  timeline: TimelineEntry[] = [];
  counters = {
    boots: 0,
    spawns: 0,
    ctxSwitches: 0,
    faults: 0,
    tlbHits: 0,
    tlbMisses: 0,
    cacheHits: 0,
    cacheMisses: 0,
    syscalls: 0,
    ioOps: 0,
    interrupts: 0,
    deadlocks: 0,
    instructions: 0,
    dmaOps: 0
  };
  metrics = {
    cpuUtil: 0,
    cacheHit: 0,
    faultRate: 0,
    avgTurnaround: 0,
    throughput: 0,
    memUsage: 0,
    seriesCpu: [] as number[],
    seriesCache: [] as number[],
    seriesFault: [] as number[]
  };
  heat: Record<PartId, number> = {
    cpu: 0,
    l1i: 0,
    l1d: 0,
    l2: 0,
    l3: 0,
    tlb: 0,
    dram: 0,
    bus: 0,
    disk: 0,
    pic: 0,
    sched: 0,
    gate: 0
  };
  private heatAcc: Record<PartId, number> = { ...this.heat };
  private win = { user: 0, kernel: 0, idle: 0, faults: 0, memAccesses: 0, finished: 0 };
  private prev = { cacheHits: 0, cacheMisses: 0 };
  private turnarounds: number[] = [];
  trace: { mode: 'instr' | 'syscall' | null; steps: TraceStep[] } = { mode: null, steps: [] };
  private traceArmed = false;
  private traceSysPid = -1;
  private fetchExhausted = false;

  private acc = 0;

  constructor(cfg: SimConfig = { ...DEFAULT_CONFIG }) {
    this.cfg = { ...cfg };
    this.rng = mulberry32(this.cfg.seed);
    this.init();
  }

  init(): void {
    this.cycle = 0;
    this.power = false;
    this.suspended = false;
    this.phase = 'idle';
    this.freq = 0;
    this.temp = 22;
    this.deadlockFlag = false;
    this.bootStage = 'off';
    this.bootIdx = 0;
    this.bootLeft = 0;
    this.shutdown = null;
    this.cpuMode = 'user';
    this.kernelTask = null;
    this.regs = new Array(8).fill(0);
    this.pc = 0;
    this.pipeIf = this.pipeId = this.pipeEx = this.pipeMem = this.pipeWb = null;
    this.memTx = null;
    this.ifTx = null;
    this.trapPending = null;
    this.quantumUsed = 0;
    this.buildCaches();
    this.tlb = new TLB();
    this.allocFrames();
    this.fs.reset();
    this.fs.alloc('boot.img', 1, 'system');
    this.fs.alloc('kernel.bin', 3, 'system');
    this.pic = { timer: false, disk: false, kbd: false };
    this.clockEnabled = false;
    this.busEnabled = false;
    this.nextTimerAt = 0;
    this.dmaQueue = [];
    this.dmaActive = null;
    this.dmaLeft = 0;
    this.completedDma = null;
    this.procs = [];
    this.readyQueue = [];
    this.currentPid = null;
    this.nextPid = 1;
    this.pendingSpawns = [];
    this.programs = new Map();
    this.pageTables = new Map();
    this.sems = [
      { id: 0, value: 1, owner: -1, waiters: [] },
      { id: 1, value: 1, owner: -1, waiters: [] }
    ];
    this.events = [];
    this.timeline = [];
    this.counters = {
      boots: 0,
      spawns: 0,
      ctxSwitches: 0,
      faults: 0,
      tlbHits: 0,
      tlbMisses: 0,
      cacheHits: 0,
      cacheMisses: 0,
      syscalls: 0,
      ioOps: 0,
      interrupts: 0,
      deadlocks: 0,
      instructions: 0,
      dmaOps: 0
    };
    this.metrics = {
      cpuUtil: 0,
      cacheHit: 0,
      faultRate: 0,
      avgTurnaround: 0,
      throughput: 0,
      memUsage: 0,
      seriesCpu: [],
      seriesCache: [],
      seriesFault: []
    };
    for (const k of Object.keys(this.heat) as PartId[]) {
      this.heat[k] = 0;
      this.heatAcc[k] = 0;
    }
    this.win = { user: 0, kernel: 0, idle: 0, faults: 0, memAccesses: 0, finished: 0 };
    this.prev = { cacheHits: 0, cacheMisses: 0 };
    this.turnarounds = [];
    this.trace = { mode: null, steps: [] };
    this.traceArmed = false;
    this.traceSysPid = -1;
    this.fetchExhausted = false;
    this.acc = 0;
  }

  reset(cfg?: Partial<SimConfig>): void {
    if (cfg) Object.assign(this.cfg, cfg);
    this.rng = mulberry32(this.cfg.seed);
    this.init();
  }

  private buildCaches(): void {
    const n = this.cfg.l1Lines;
    this.l1i = new CacheModel(n);
    this.l1d = new CacheModel(n);
    this.l2 = new CacheModel(n * 4);
    this.l3 = new CacheModel(n * 16);
    this.prev.cacheHits = 0;
    this.prev.cacheMisses = 0;
  }

  private allocFrames(): void {
    this.frames = Array.from({ length: this.cfg.frames }, () => ({
      state: 'free' as FrameState,
      pid: -1,
      dirty: false
    }));
    this.frameLastUse = new Array(this.cfg.frames).fill(0);
    this.frameMap = new Array(this.cfg.frames).fill(null);
    this.framePending = new Array(this.cfg.frames).fill(false);
  }

  // ---------- 命令 ----------

  powerOn(): boolean {
    if (this.power || this.suspended) return false;
    this.power = true;
    this.phase = 'boot';
    this.counters.boots++;
    this.cpuMode = 'kernel';
    this.bootIdx = 0;
    this.bootStage = 'post-cpu';
    this.bootLeft = BOOT_PLAN[0].cycles;
    this.clockEnabled = true;
    this.busEnabled = true;
    this.nextTimerAt = this.cycle + TIMER_PERIOD;
    this.allocFrames();
    for (let i = 0; i < Math.min(KERNEL_FRAMES, this.frames.length); i++) {
      this.frames[i] = { state: 'kernel', pid: -1, dirty: false };
    }
    this.buildCaches();
    this.tlb.flushAll();
    this.procs = [];
    this.readyQueue = [];
    this.currentPid = null;
    this.pendingSpawns = [];
    this.programs = new Map();
    this.pageTables = new Map();
    this.sems = [
      { id: 0, value: 1, owner: -1, waiters: [] },
      { id: 1, value: 1, owner: -1, waiters: [] }
    ];
    this.deadlockFlag = false;
    this.dmaQueue = [];
    this.dmaActive = null;
    this.dmaLeft = 0;
    this.completedDma = null;
    this.shutdown = null;
    this.trapPending = null;
    this.emit('power_on');
    this.tl('boot', 'tl_boot_start');
    this.emit('post_stage', { text: 'post-cpu' });
    return true;
  }

  requestShutdown(): boolean {
    if (!this.power || this.shutdown || this.suspended) return false;
    this.shutdown = { stage: 'finish', cap: this.cycle + Math.min(this.cfg.quantum, 1200) };
    this.emit('shutdown_stage', { text: 'begin' });
    this.tl('shutdown', 'tl_shutdown_begin');
    return true;
  }

  triggerKbd(): void {
    if (!this.power) return;
    this.pic.kbd = true;
    this.counters.interrupts++;
    this.emit('int_kbd', { line: 'kbd' });
  }

  spawnProcess(role: ProcRole, prio?: number): boolean {
    if (!this.power || this.bootStage !== 'done' || this.shutdown) return false;
    if (this.procs.filter((p) => p.state !== 'terminated').length >= MAX_PROCS) return false;
    this.pendingSpawns.push({ role, prio });
    return true;
  }

  setConfig(partial: Partial<SimConfig>): void {
    if (partial.algo !== undefined) this.cfg.algo = partial.algo;
    if (partial.quantum !== undefined) this.cfg.quantum = Math.max(40, Math.min(4000, partial.quantum));
    if (partial.speed !== undefined) this.cfg.speed = partial.speed;
    if (partial.seed !== undefined) this.cfg.seed = partial.seed;
    if (partial.l1Lines !== undefined && partial.l1Lines !== this.cfg.l1Lines) {
      this.cfg.l1Lines = partial.l1Lines;
      this.buildCaches();
      this.tlb.flushAll();
    }
    if (partial.frames !== undefined && !this.power && partial.frames !== this.cfg.frames) {
      this.cfg.frames = Math.max(12, Math.min(96, partial.frames));
      this.allocFrames();
    }
  }

  setSuspended(flag: boolean): void {
    if (this.suspended === flag) return;
    this.suspended = flag;
    if (flag) {
      this.emit('suspend');
      this.tl('suspend', 'tl_suspend');
    } else {
      this.emit('resume');
      this.tl('suspend', 'tl_resume');
    }
  }

  startTrace(mode: 'instr' | 'syscall'): void {
    this.trace = { mode, steps: [] };
    this.traceArmed = mode === 'instr';
    this.traceSysPid = -1;
  }

  stopTrace(): void {
    this.trace = { mode: null, steps: [] };
    this.traceArmed = false;
    this.traceSysPid = -1;
  }

  // ---------- 事件与观测 ----------

  emit(kind: EvKind, extra: Partial<SimEvent> = {}): void {
    this.events.push({ t: this.cycle, kind, ...extra });
    if (this.events.length > 1600) this.events.splice(0, 400);
    switch (kind) {
      case 'ctx_load':
        this.counters.ctxSwitches++;
        break;
      case 'tlb_hit':
        this.counters.tlbHits++;
        break;
      case 'tlb_miss':
        this.counters.tlbMisses++;
        break;
      case 'cache_hit':
        this.counters.cacheHits++;
        break;
      case 'cache_miss':
        this.counters.cacheMisses++;
        break;
      case 'page_fault':
        this.counters.faults++;
        break;
      case 'syscall_enter':
        this.counters.syscalls++;
        break;
      case 'int_timer':
      case 'int_disk':
        this.counters.interrupts++;
        break;
      case 'dma_start':
        this.counters.dmaOps++;
        break;
      case 'deadlock':
        this.counters.deadlocks++;
        break;
      default:
        break;
    }
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0);
  }

  tl(kind: TlKind, key: string, extra: Partial<TimelineEntry> = {}): void {
    this.timeline.push({ t: this.cycle, kind, key, ...extra });
    if (this.timeline.length > 80) this.timeline.shift();
  }

  act(part: PartId, n = 1): void {
    this.heatAcc[part] += n;
  }

  private traceStep(key: string, extra: Partial<TraceStep> = {}): void {
    if (!this.trace.mode) return;
    this.trace.steps.push({ key, t: this.cycle, ...extra });
    if (this.trace.steps.length > 14) this.trace.steps.shift();
    this.emit('trace_step', { text: key, pid: extra.pid, num: extra.num, sys: extra.sys });
  }

  // ---------- 主循环 ----------

  advance(dtSec: number, speedMult: number): void {
    if (!this.power || this.suspended) return;
    this.acc += dtSec * CYCLES_PER_SEC * speedMult;
    const steps = Math.min(Math.floor(this.acc), 4000);
    this.acc -= Math.floor(this.acc);
    for (let i = 0; i < steps; i++) this.step();
  }

  step(): void {
    if (!this.power || this.suspended) return;
    this.cycle++;

    if (this.clockEnabled && this.cycle >= this.nextTimerAt) {
      this.nextTimerAt += TIMER_PERIOD;
      this.pic.timer = true;
      this.emit('int_timer', { line: 'timer' });
    }

    this.stepDma();
    this.checkSleepers();

    // 安全机制:内核无待办任务时回到用户态,保证中断能被投递(避免内核空转死锁)
    if (this.cpuMode === 'kernel' && !this.kernelTask && this.bootStage === 'done' && !this.shutdown) {
      this.cpuMode = 'user';
    }

    // 空闲时装载器兜底(所有进程退出后用户再装载)
    if (
      this.bootStage === 'done' &&
      !this.kernelTask &&
      this.pendingSpawns.length > 0 &&
      !this.shutdown &&
      this.cpuMode === 'user'
    ) {
      this.startLoader();
    }

    if (this.cpuMode === 'kernel') this.stepKernel();
    else this.stepUser();

    if (this.bootStage !== 'done' && this.bootStage !== 'off') {
      this.act('cpu');
      if (this.bootLeft > 0) {
        this.bootLeft--;
        if (this.bootLeft === 0) this.advanceBoot();
      }
    }

    if (this.shutdown && this.shutdown.stage === 'finish') {
      const cur = this.currentProc();
      const done =
        !cur ||
        cur.state !== 'running' ||
        this.quantumUsed >= this.cfg.quantum ||
        this.cycle > this.shutdown.cap;
      if (done) {
        this.shutdown.stage = 'reclaim';
        this.emit('shutdown_stage', { text: 'slice-done' });
        this.tl('shutdown', 'tl_shutdown_slice');
        this.flushPipeline();
        this.saveContext();
        this.cpuMode = 'kernel';
        this.currentPid = null;
        this.shutdownNext();
      }
    }

    const freqTarget =
      this.shutdown && ['cooldown', 'clock-stop', 'bus-off'].includes(this.shutdown.stage)
        ? 0
        : this.power
          ? 1
          : 0;
    this.freq += (freqTarget - this.freq) * 0.02;
    const tempTarget = 22 + this.metrics.cpuUtil * 34;
    this.temp += (tempTarget - this.temp) * 0.004;

    this.phase = this.computePhase();

    if (this.cycle % 60 === 0) this.metricWindow();
  }

  private computePhase(): Phase {
    if (!this.power) return 'idle';
    if (this.shutdown) return 'halt';
    if (this.bootStage !== 'done' && this.bootStage !== 'off') return 'boot';
    const k = this.kernelTask?.kind;
    if (k === 'loader') return 'load';
    if (this.pendingSpawns.length > 0 && !this.kernelTask) return 'load';
    if (k === 'isr-timer' || k === 'isr-disk' || k === 'isr-kbd' || k === 'syscall') return 'intr';
    if (k === 'switch') return 'ctx';
    if (k === 'fault') return 'mem';
    if (this.memTx || this.ifTx) return 'mem';
    if (!this.currentPid) {
      const blocked = this.procs.some((p) => p.state === 'blocked');
      return blocked ? 'io' : 'ready';
    }
    return 'exec';
  }

  // ---------- 用户态流水线 ----------

  private stepUser(): void {
    // 1. WB 提交(流水线自身事务,与进程状态无关)
    if (this.pipeWb) this.commitWB();
    if (this.cpuMode === 'kernel') return; // 量子抢占等触发了内核任务

    // 2. 中断注入(指令边界:当前访存事务完成后)
    if (!this.trapPending && this.pendingInterrupt() && !this.memTx && !this.ifTx) {
      this.flushPipeline();
      this.enterIsr();
      return;
    }

    // 3. 陷入投递(系统调用/缺页):流水线排空后进入内核;即使当前无运行进程(缺页进程已阻塞)
    const drained =
      !this.pipeMem && !this.pipeEx && !this.pipeId && !this.pipeIf && !this.memTx && !this.ifTx;
    if (drained) {
      if (!this.trapPending && this.fetchExhausted) {
        // PC 越过程序末尾仍无跳转拉回 → 按结束处理
        const prog = this.currentPid !== null ? this.programs.get(this.currentPid) : null;
        if (!prog || this.pc >= prog.length) {
          this.trapPending = { kind: 'sys', sys: 'exit', pid: this.currentPid ?? -1 };
        }
        this.fetchExhausted = false;
      }
      if (this.trapPending) {
        this.enterKernelFromTrap();
        return;
      }
    }

    const proc = this.currentProc();
    if (!proc || proc.state !== 'running') {
      this.win.idle++;
      return;
    }
    this.win.user++;
    this.act('cpu');
    this.quantumUsed++;
    proc.cpuTime++;

    // 4. MEM 段
    if (this.memTx) {
      this.advanceTx(this.memTx);
    } else if (this.pipeMem) {
      const cell = this.pipeMem;
      if (cell.instr.op === 'lw' || cell.instr.op === 'sw') {
        this.beginMemTx(cell);
      } else {
        this.pipeWb = cell;
        this.pipeMem = null;
      }
    }

    // 5. EX 段与整条流水线前移(MEM 空闲时;陷入等待期间照常排空)
    if (!this.pipeMem && !this.memTx) {
      if (this.pipeEx) {
        const consumed = this.execEx(this.pipeEx);
        if (!consumed) this.pipeMem = this.pipeEx;
        this.pipeEx = this.pipeId;
        this.pipeId = this.pipeIf;
        this.pipeIf = null;
      } else if (this.pipeId) {
        this.pipeEx = this.pipeId;
        this.pipeId = this.pipeIf;
        this.pipeIf = null;
      } else if (this.pipeIf) {
        this.pipeId = this.pipeIf;
        this.pipeIf = null;
      }
    }

    // 6. IF 段
    if (!this.pipeIf && !this.ifTx && !this.trapPending) {
      this.beginIfetch();
    } else if (this.ifTx) {
      this.advanceTx(this.ifTx);
    }
  }

  private flushPipeline(): void {
    if (this.pipeWb) {
      this.commitWBCell(this.pipeWb);
      this.pipeWb = null;
    }
    const cells = [this.pipeMem, this.pipeEx, this.pipeId, this.pipeIf].filter(Boolean) as PipeCell[];
    if (cells.length > 0) this.pc = Math.min(...cells.map((c) => c.pc));
    this.pipeMem = this.pipeEx = this.pipeId = this.pipeIf = null;
    this.memTx = null;
    this.ifTx = null;
  }

  private commitWBCell(cell: PipeCell): void {
    if (cell.destReg >= 1) this.regs[cell.destReg] = cell.result & 0xffff;
    this.counters.instructions++;
    const proc = this.procOf(cell.pid);
    if (proc) proc.burstRemaining = Math.max(0, proc.burstRemaining - 1);
    if (cell.traced) {
      this.traceStep('tr_done', { pid: cell.pid, num: cell.pc });
      this.trace.mode = null;
    }
  }

  private commitWB(): void {
    const cell = this.pipeWb!;
    this.pipeWb = null;
    this.commitWBCell(cell);
    if (
      this.cfg.algo === 'rr' &&
      this.quantumUsed >= this.cfg.quantum &&
      !this.shutdown &&
      !this.trapPending &&
      !this.memTx
    ) {
      this.emit('quantum_end', { pid: this.currentPid ?? undefined });
      this.tl('preempt', 'tl_quantum', { pid: this.currentPid ?? undefined, num: this.cfg.quantum });
      this.flushPipeline();
      this.saveContext();
      this.schedule(true);
    }
  }

  /** 读寄存器(带 EX-EX 旁路:未写回的更老指令结果直接前递) */
  private reg(n: number): number {
    if (n <= 0) return 0;
    if (this.pipeMem && this.pipeMem.destReg === n) return this.pipeMem.result & 0xffff;
    if (this.pipeWb && this.pipeWb.destReg === n) return this.pipeWb.result & 0xffff;
    return this.regs[n] ?? 0;
  }

  private execEx(cell: PipeCell): boolean {
    const i = cell.instr;
    switch (i.op) {
      case 'li':
        cell.result = i.imm ?? 0;
        cell.destReg = i.rd ?? -1;
        break;
      case 'add':
        cell.result = (this.reg(i.rs ?? 0) + this.reg(i.rt ?? 0)) & 0xffff;
        cell.destReg = i.rd ?? -1;
        break;
      case 'addi':
        cell.result = (this.reg(i.rs ?? 0) + (i.imm ?? 0)) & 0xffff;
        cell.destReg = i.rd ?? -1;
        break;
      case 'sub':
        cell.result = (this.reg(i.rs ?? 0) - this.reg(i.rt ?? 0)) & 0xffff;
        cell.destReg = i.rd ?? -1;
        break;
      case 'mul':
        cell.result = (this.reg(i.rs ?? 0) * this.reg(i.rt ?? 0)) & 0xffff;
        cell.destReg = i.rd ?? -1;
        break;
      case 'div': {
        const d = this.reg(i.rt ?? 0);
        cell.result = d === 0 ? 0 : Math.floor(this.reg(i.rs ?? 0) / d) & 0xffff;
        cell.destReg = i.rd ?? -1;
        break;
      }
      case 'lw':
        cell.va = (this.reg(i.rs ?? 0) + (i.imm ?? 0)) & 0xffff;
        cell.destReg = i.rd ?? -1;
        break;
      case 'sw':
        cell.va = (this.reg(i.rt ?? 0) + (i.imm ?? 0)) & 0xffff;
        cell.storeVal = this.reg(i.rd ?? 0);
        cell.destReg = -1;
        break;
      case 'beq':
      case 'bne': {
        const a = this.reg(i.rs ?? 0);
        const b = this.reg(i.rt ?? 0);
        const taken = i.op === 'beq' ? a === b : a !== b;
        this.emit('branch', { pid: cell.pid });
        if (taken) {
          this.pc = i.target ?? 0;
          this.pipeIf = null;
          this.pipeId = null;
          this.ifTx = null; // 取消在途的错误路径预取
          this.emit('branch_flush', { pid: cell.pid });
        }
        cell.destReg = -1;
        break;
      }
      case 'jmp':
        this.pc = i.target ?? 0;
        this.pipeIf = null;
        this.pipeId = null;
        this.ifTx = null;
        cell.destReg = -1;
        break;
      case 'sys':
        this.trapPending = { kind: 'sys', sys: i.sys, pid: cell.pid };
        this.pipeIf = null;
        this.pipeId = null;
        this.ifTx = null;
        if (this.trace.mode === 'syscall') {
          this.traceSysPid = cell.pid;
          this.traceStep('tr_sys_trap', { pid: cell.pid, sys: i.sys });
        }
        return true;
      default:
        cell.destReg = -1;
        break;
    }
    if (cell.traced) this.traceStep('tr_ex', { pid: cell.pid, num: cell.pc });
    return false;
  }

  // ---------- 取指与访存事务 ----------

  private beginIfetch(): void {
    const proc = this.currentProc();
    if (!proc) return;
    const prog = this.programs.get(proc.pid);
    if (!prog || this.pc >= prog.length) {
      this.fetchExhausted = true;
      return;
    }
    const va = CODE_PAGE * PAGE_SIZE + this.pc * 4;
    const traced = this.traceArmed;
    if (traced) {
      this.traceArmed = false;
      this.traceStep('tr_if_begin', { pid: proc.pid, num: this.pc });
    }
    this.ifTx = {
      kind: 'ifetch',
      pid: proc.pid,
      pc: this.pc,
      va,
      write: false,
      step: 'tlb',
      remaining: 1,
      pa: -1,
      cell: null,
      traced
    };
  }

  private beginMemTx(cell: PipeCell): void {
    this.memTx = {
      kind: cell.instr.op === 'lw' ? 'load' : 'store',
      pid: cell.pid,
      pc: cell.pc,
      va: cell.va,
      write: cell.instr.op === 'sw',
      step: 'tlb',
      remaining: 1,
      pa: -1,
      cell,
      traced: cell.traced
    };
    this.win.memAccesses++; // 缺页率分母:数据访存事务
  }

  /** 推进一个访存事务:TLB → 页表 → L1 → L2 → L3 → DRAM */
  private advanceTx(tx: MemTx): void {
    tx.remaining--;
    if (tx.remaining > 0) return;
    const pid = tx.pid;
    const vpn = Math.floor(tx.va / PAGE_SIZE);
    const off = tx.va % PAGE_SIZE;
    const traced = tx.traced;

    switch (tx.step) {
      case 'tlb': {
        this.act('tlb');
        const pfn = this.tlb.lookup(pid, vpn, this.cycle);
        if (pfn >= 0) {
          this.emit('tlb_hit', { pid, vpn, pfn });
          if (traced) this.traceStep('tr_tlb_hit', { pid, vpn });
          tx.pa = pfn * PAGE_SIZE + off;
          tx.step = 'l1';
          tx.remaining = 1;
        } else {
          this.emit('tlb_miss', { pid, vpn });
          if (traced) this.traceStep('tr_tlb_miss', { pid, vpn });
          tx.step = 'ptwalk';
          tx.remaining = PTWALK_CYCLES;
        }
        break;
      }
      case 'ptwalk': {
        this.act('tlb');
        this.act('dram');
        this.emit('pt_walk', { pid, vpn });
        const pt = this.pageTables.get(pid);
        const pfn = pt ? this.walkPresent(pt, vpn) : -1;
        if (pfn >= 0) {
          this.tlb.insert(pid, vpn, pfn, this.cycle);
          tx.pa = pfn * PAGE_SIZE + off;
          if (traced) this.traceStep('tr_ptwalk_hit', { pid, vpn });
          tx.step = 'l1';
          tx.remaining = 1;
        } else {
          this.pageFaultTx(tx, vpn);
        }
        break;
      }
      case 'l1': {
        const isIfetch = tx.kind === 'ifetch';
        const cache = isIfetch ? this.l1i : this.l1d;
        this.act(isIfetch ? 'l1i' : 'l1d');
        const res = cache.access(tx.pa, tx.write, this.cycle);
        if (res.hit) {
          this.emit('cache_hit', { pid, level: isIfetch ? 'l1i' : 'l1d', pa: tx.pa });
          if (traced) this.traceStep('tr_l1_hit', { pid });
          this.finishTx(tx);
        } else {
          this.emit('cache_miss', { pid, level: isIfetch ? 'l1i' : 'l1d', pa: tx.pa });
          if (res.dirtyEvict) this.emit('cache_writeback', { pa: res.evictedBlock * 32 });
          if (traced) this.traceStep('tr_l1_miss', { pid });
          tx.step = 'l2';
          tx.remaining = L2_CYCLES;
        }
        break;
      }
      case 'l2': {
        this.act('l2');
        const res = this.l2.access(tx.pa, tx.write, this.cycle);
        if (res.hit) {
          this.emit('cache_hit', { pid, level: 'l2', pa: tx.pa });
          this.fillFrom(tx, 'l2');
          if (traced) this.traceStep('tr_l2_hit', { pid });
          this.finishTx(tx);
        } else {
          this.emit('cache_miss', { pid, level: 'l2', pa: tx.pa });
          if (res.dirtyEvict) this.emit('cache_writeback', { pa: res.evictedBlock * 32 });
          if (traced) this.traceStep('tr_l2_miss', { pid });
          tx.step = 'l3';
          tx.remaining = L3_CYCLES;
        }
        break;
      }
      case 'l3': {
        this.act('l3');
        const res = this.l3.access(tx.pa, tx.write, this.cycle);
        if (res.hit) {
          this.emit('cache_hit', { pid, level: 'l3', pa: tx.pa });
          this.fillFrom(tx, 'l3');
          if (traced) this.traceStep('tr_l3_hit', { pid });
          this.finishTx(tx);
        } else {
          this.emit('cache_miss', { pid, level: 'l3', pa: tx.pa });
          if (res.dirtyEvict) this.emit('cache_writeback', { pa: res.evictedBlock * 32 });
          if (traced) this.traceStep('tr_l3_miss', { pid });
          tx.step = 'dram';
          tx.remaining = DRAM_CYCLES;
        }
        break;
      }
      case 'dram': {
        this.act('dram');
        this.act('bus');
        this.fillFrom(tx, 'dram');
        if (traced) this.traceStep('tr_dram_fill', { pid });
        this.finishTx(tx);
        break;
      }
      default:
        break;
    }
  }

  /** 从 from 层向下填充缓存(含相应层访问) */
  private fillFrom(tx: MemTx, from: 'l2' | 'l3' | 'dram'): void {
    const pfn = Math.floor(tx.pa / PAGE_SIZE);
    const isIfetch = tx.kind === 'ifetch';
    const l1 = isIfetch ? this.l1i : this.l1d;
    if (from === 'l2') {
      this.emit('cache_fill', { level: isIfetch ? 'l1i' : 'l1d', pa: tx.pa, pfn });
      l1.access(tx.pa, tx.write, this.cycle);
    } else if (from === 'l3') {
      this.emit('cache_fill', { level: 'l2', pa: tx.pa, pfn });
      this.l2.access(tx.pa, tx.write, this.cycle);
      this.emit('cache_fill', { level: isIfetch ? 'l1i' : 'l1d', pa: tx.pa, pfn });
      l1.access(tx.pa, tx.write, this.cycle);
    } else {
      this.emit('cache_fill', { level: 'l3', pa: tx.pa, pfn });
      this.l3.access(tx.pa, tx.write, this.cycle);
      this.emit('cache_fill', { level: 'l2', pa: tx.pa, pfn });
      this.l2.access(tx.pa, tx.write, this.cycle);
      this.emit('cache_fill', { level: isIfetch ? 'l1i' : 'l1d', pa: tx.pa, pfn });
      l1.access(tx.pa, tx.write, this.cycle);
    }
  }

  private walkPresent(pt: PageTable, vpn: number): number {
    const pte = getPTE(pt, vpn);
    return pte && pte.present ? pte.pfn : -1;
  }

  private finishTx(tx: MemTx): void {
    if (tx.pa >= 0) {
      const pfn = Math.floor(tx.pa / PAGE_SIZE);
      this.frameLastUse[pfn] = this.cycle;
      if (tx.write) {
        this.frames[pfn].dirty = true;
        const m = this.frameMap[pfn];
        if (m) {
          const pte = this.getPteOf(m.pid, m.vpn);
          if (pte) pte.dirty = true;
        }
      }
    }
    if (tx.kind === 'ifetch') {
      const prog = this.programs.get(tx.pid);
      if (prog && tx.pc < prog.length) {
        this.pipeIf = {
          pid: tx.pid,
          pc: tx.pc,
          instr: prog[tx.pc],
          traced: tx.traced,
          destReg: -1,
          result: 0,
          va: 0,
          storeVal: 0
        };
        this.pc = tx.pc + 1;
        this.emit('ifetch', { pid: tx.pid, va: tx.va });
        if (tx.traced) this.traceStep('tr_if_done', { pid: tx.pid, num: tx.pc });
      }
      this.ifTx = null;
    } else {
      const cell = tx.cell!;
      if (tx.kind === 'load') cell.result = (Math.imul(tx.pa, 2654435761) >>> 0) % 65536;
      this.pipeWb = cell;
      this.pipeMem = null;
      this.memTx = null;
      if (cell.traced) this.traceStep('tr_mem_done', { pid: cell.pid });
    }
  }

  private pageFaultTx(tx: MemTx, vpn: number): void {
    const pid = tx.pid;
    const proc = this.procOf(pid);
    this.emit('page_fault', { pid, vpn, va: tx.va });
    this.tl('fault', 'tl_fault', { pid, num: vpn });
    if (proc) {
      proc.faults++;
    }
    this.win.faults++;
    this.pc = tx.pc; // 缺页指令重试(先回滚 PC,再保存阻塞上下文)
    this.pipeMem = null;
    this.pipeEx = null;
    this.pipeId = null;
    this.pipeIf = null;
    this.memTx = null;
    this.ifTx = null;
    if (proc) this.blockProc(proc, 'page');
    if (tx.traced) {
      this.traceStep('tr_fault', { pid, vpn });
      this.traceArmed = true; // 重试指令继续跟随
    }
    this.trapPending = { kind: 'fault', pid, vpn };
  }

  private blockProc(proc: PCB, kind: 'io' | 'sem' | 'page' | 'sleep', semId?: number, until?: number): void {
    // 先把 CPU 寄存器与 PC 存入 PCB,再进入阻塞(保证换出/唤醒后恢复完整)
    proc.regs = [...this.regs];
    proc.pc = this.pc;
    proc.state = 'blocked';
    proc.blockOn = { kind, semId, until };
    if (this.currentPid === proc.pid) this.currentPid = null;
    this.emit('proc_block', { pid: proc.pid });
  }

  // ---------- 内核态 ----------

  private stepKernel(): void {
    this.act('cpu');
    if (!this.kernelTask) {
      this.win.kernel++;
      return;
    }
    this.win.kernel++;
    const task = this.kernelTask;
    task.cyclesLeft--;
    if (task.kind === 'shutdown' && task.data.sub === 'cooldown') {
      task.data.progress = 1 - task.cyclesLeft / 140;
      this.emit('freq_change', { num: task.data.progress });
    }
    if (task.cyclesLeft <= 0) this.finishKernelTask();
  }

  private finishKernelTask(): void {
    const task = this.kernelTask!;
    this.kernelTask = null;
    switch (task.kind) {
      case 'isr-timer':
      case 'isr-disk':
      case 'isr-kbd':
        this.emit('isr_exit', {
          line: task.kind === 'isr-timer' ? 'timer' : task.kind === 'isr-disk' ? 'disk' : 'kbd'
        });
        break;
      default:
        this.emit('kernel_exit');
        break;
    }

    switch (task.kind) {
      case 'isr-timer': {
        this.pic.timer = false;
        const cur = this.currentProc();
        const preemptRR = this.cfg.algo === 'rr' && cur && this.quantumUsed >= this.cfg.quantum;
        const preemptPrio = cur ? shouldPreemptPrio(this.cfg.algo, cur, this.readyPCBs()) : false;
        if ((preemptRR || preemptPrio) && cur && !this.shutdown) {
          if (preemptRR) {
            this.emit('quantum_end', { pid: cur.pid });
            this.tl('preempt', 'tl_quantum', { pid: cur.pid, num: this.cfg.quantum });
          } else {
            this.tl('preempt', 'tl_preempt_prio', { pid: cur.pid });
          }
          this.schedule(true);
        } else {
          this.cpuMode = 'user';
        }
        break;
      }
      case 'isr-disk': {
        this.pic.disk = false;
        const job = this.completedDma;
        this.completedDma = null;
        if (job) this.handleDmaResult(job);
        else this.cpuMode = 'user';
        break;
      }
      case 'isr-kbd':
        this.pic.kbd = false;
        this.cpuMode = 'user';
        break;
      case 'switch': {
        const to = task.data.to ?? -1;
        const pcb = to >= 0 ? this.procOf(to) : null;
        if (pcb) {
          this.currentPid = to;
          this.restoreContext(pcb);
          this.emit('ctx_load', { pid: to });
          this.tl('sched', 'tl_switch_in', { pid: to, a: this.cfg.algo });
        } else {
          this.currentPid = null;
        }
        this.cpuMode = 'user';
        break;
      }
      case 'loader': {
        this.createProcess(task.data.role!, task.data.prio);
        this.afterKernelTask();
        break;
      }
      case 'syscall':
        this.handleSyscall(task.data.sys!, task.data.pid!);
        break;
      case 'fault':
        this.faultStep(task.data.pid!, task.data.vpn!);
        break;
      case 'shutdown':
        if (task.data.sub === 'reclaim' && task.data.pid !== undefined) {
          this.reclaimProcess(task.data.pid);
        }
        this.finishShutdownTask(task.data.sub!);
        break;
      default:
        break;
    }
  }

  private afterKernelTask(): void {
    if (this.kernelTask) return;
    if (this.shutdown) {
      this.shutdownNext();
      return;
    }
    if (this.pendingSpawns.length > 0 && this.bootStage === 'done') {
      this.startLoader();
      return;
    }
    this.schedule(false);
  }

  // ---------- 缺页处理链 ----------

  private faultStep(pid: number, vpn: number): void {
    const pte = this.getPteOf(pid, vpn);
    if (!pte) {
      this.tl('fault', 'tl_fault_nomap', { pid, num: vpn });
      this.reclaimProcess(pid);
      this.afterKernelTask();
      return;
    }
    if (pte.present) {
      this.wakeProcess(pid, 'page');
      this.afterKernelTask();
      return;
    }
    let frame = this.findFreeFrame();
    if (frame < 0) {
      const victim = this.pickVictimFrame();
      const m = this.frameMap[victim];
      if (!m) {
        this.tl('fault', 'tl_oom', { pid });
        this.reclaimProcess(pid);
        this.afterKernelTask();
        return;
      }
      frame = victim;
      const ownerPte = this.getPteOf(m.pid, m.vpn);
      this.emit('fault_evict', { pfn: frame, pid: m.pid, vpn: m.vpn });
      this.tl('fault', 'tl_evict', { pid: m.pid, num: m.vpn });
      this.flushPFN(frame);
      this.invalidateFrameCaches(frame);
      if (ownerPte) ownerPte.present = false;
      this.tlb.invalidate(m.pid, m.vpn);
      this.frames[frame] = { state: 'user', pid, dirty: false };
      this.frameMap[frame] = { pid, vpn };
      this.framePending[frame] = true; // 换入完成前不可再被逐出
      const needsWriteback = this.frames[frame].dirty || (ownerPte && ownerPte.dirty);
      if (needsWriteback && ownerPte) {
        this.enqueueDma({
          kind: 'write',
          block: ownerPte.diskBlock,
          frame,
          tag: { type: 'evict', ownerPid: m.pid, ownerVpn: m.vpn, pid, vpn }
        });
        this.emit('fault_writeback', { pfn: frame, pid: m.pid });
        if (this.trace.mode) this.traceStep('tr_fault_wb', { pid });
        this.afterKernelTask();
        return;
      }
      this.enqueueDma({ kind: 'read', block: pte.diskBlock, frame, tag: { type: 'pagein', pid, vpn } });
      this.emit('fault_read', { pid, vpn, pfn: frame });
      if (this.trace.mode) this.traceStep('tr_fault_read', { pid, vpn });
      this.afterKernelTask();
      return;
    }
    this.frames[frame] = { state: 'user', pid, dirty: false };
    this.frameMap[frame] = { pid, vpn };
    this.framePending[frame] = true;
    this.enqueueDma({ kind: 'read', block: pte.diskBlock, frame, tag: { type: 'pagein', pid, vpn } });
    this.emit('fault_read', { pid, vpn, pfn: frame });
    if (this.trace.mode) this.traceStep('tr_fault_read', { pid, vpn });
    this.afterKernelTask();
  }

  private getPteOf(pid: number, vpn: number): PTE | null {
    const pt = this.pageTables.get(pid);
    return pt ? getPTE(pt, vpn) : null;
  }

  private findFreeFrame(): number {
    for (let i = KERNEL_FRAMES; i < this.frames.length; i++) {
      if (this.frames[i].state === 'free') return i;
    }
    return -1;
  }

  private pickVictimFrame(): number {
    let best = -1;
    let bestUse = Infinity;
    for (let i = KERNEL_FRAMES; i < this.frames.length; i++) {
      if (this.frames[i].state === 'user' && !this.framePending[i] && this.frameLastUse[i] < bestUse) {
        bestUse = this.frameLastUse[i];
        best = i;
      }
    }
    return best;
  }

  /** 页框被逐出前:脏缓存行全部写回 DRAM(保证一致性) */
  private flushPFN(pfn: number): void {
    const lo = pfn * 8;
    const hi = lo + 8;
    for (const cache of [this.l1i, this.l1d, this.l2, this.l3]) {
      for (const line of cache.lines) {
        if (line.valid && line.dirty && line.block >= lo && line.block < hi) {
          cache.writebacks++;
          this.emit('cache_writeback', { pa: line.block * 32 });
          line.dirty = false;
        }
      }
    }
    this.frames[pfn].dirty = false;
  }

  private invalidateFrameCaches(pfn: number): void {
    this.l1i.invalidatePFN(pfn);
    this.l1d.invalidatePFN(pfn);
    this.l2.invalidatePFN(pfn);
    this.l3.invalidatePFN(pfn);
  }

  // ---------- DMA 与设备 ----------

  private enqueueDma(job: Omit<DmaJob, 'id'>): void {
    this.dmaQueue.push({ ...job, id: this.dmaNextId++ });
  }

  private stepDma(): void {
    if (!this.busEnabled) return;
    if (!this.dmaActive && this.dmaQueue.length > 0) {
      this.dmaActive = this.dmaQueue.shift()!;
      this.dmaLeft = DMA_CYCLES;
      this.emit('dma_start', { pfn: this.dmaActive.frame, num: this.dmaActive.block });
      this.emit(this.dmaActive.kind === 'read' ? 'disk_read' : 'disk_write', {
        pfn: this.dmaActive.frame,
        num: this.dmaActive.block
      });
    }
    if (!this.dmaActive) return;
    this.act('bus', 2);
    this.act('disk');
    this.dmaLeft--;
    if (this.dmaLeft > 0) return;
    const job = this.dmaActive;
    this.dmaActive = null;
    if (job.kind === 'read') this.fs.reads++;
    else this.fs.writes++;
    this.counters.ioOps++;
    this.emit('dma_done', { pfn: job.frame, num: job.block });
    this.emit('bus_transfer', { pfn: job.frame });
    this.pic.disk = true;
    this.completedDma = job;
    if (this.cpuMode === 'user' || (this.cpuMode === 'kernel' && !this.kernelTask)) {
      this.flushPipeline();
      this.enterIsr();
    }
  }

  private handleDmaResult(job: DmaJob): void {
    switch (job.tag.type) {
      case 'boot':
        this.advanceBoot();
        break;
      case 'evict': {
        const { pid, vpn } = job.tag;
        const pte = pid !== undefined && vpn !== undefined ? this.getPteOf(pid, vpn) : null;
        if (pte) {
          this.enqueueDma({ kind: 'read', block: pte.diskBlock, frame: job.frame, tag: { type: 'pagein', pid, vpn } });
          this.emit('fault_read', { pid, vpn, pfn: job.frame });
        } else if (pid !== undefined) {
          this.framePending[job.frame] = false;
          this.freeFrame(job.frame);
          this.wakeProcess(pid, 'page');
        }
        this.afterKernelTask();
        break;
      }
      case 'pagein': {
        const { pid, vpn } = job.tag;
        this.framePending[job.frame] = false;
        if (pid !== undefined && vpn !== undefined) {
          const pte = this.getPteOf(pid, vpn);
          if (pte) {
            pte.present = true;
            pte.pfn = job.frame;
            pte.dirty = false;
            this.tlb.insert(pid, vpn, job.frame, this.cycle);
            this.frameLastUse[job.frame] = this.cycle;
            this.emit('fault_done', { pid, vpn, pfn: job.frame });
            this.tl('fault', 'tl_pagein', { pid, num: vpn });
            if (this.trace.mode) this.traceStep('tr_fault_done', { pid, vpn });
            this.wakeProcess(pid, 'page');
          } else {
            // 进程已退出:释放预留帧
            this.freeFrame(job.frame);
          }
        }
        this.afterKernelTask();
        break;
      }
      case 'io': {
        const pid = job.tag.wake ?? -1;
        this.emit('syscall_exit', { pid });
        this.tl('sys', 'tl_io_done', { pid });
        if (this.trace.mode === 'syscall') this.traceStep('tr_sys_dma', { pid });
        if (this.trace.mode === 'syscall' && pid === this.traceSysPid) {
          this.traceStep('tr_sys_return', { pid });
          this.traceStep('tr_sys_done', { pid });
          this.trace.mode = null;
        }
        this.wakeProcess(pid, 'io');
        this.afterKernelTask();
        break;
      }
      case 'checkpoint': {
        if (this.shutdown) {
          this.shutdown.stage = 'cooldown';
          this.emit('checkpoint');
          this.tl('checkpoint', 'tl_checkpoint');
          this.kernelTask = { kind: 'shutdown', cyclesLeft: 140, data: { sub: 'cooldown' } };
        }
        break;
      }
      default:
        this.afterKernelTask();
        break;
    }
  }

  private checkSleepers(): void {
    for (const p of this.procs) {
      if (p.state === 'blocked' && p.blockOn?.kind === 'sleep' && (p.blockOn.until ?? 0) <= this.cycle) {
        this.wakeProcess(p.pid, 'sleep');
      }
    }
  }

  private pendingInterrupt(): boolean {
    return this.pic.timer || this.pic.disk || this.pic.kbd;
  }

  private enterIsr(): void {
    const line = this.pic.disk ? 'disk' : this.pic.timer ? 'timer' : 'kbd';
    this.flushPipeline();
    this.cpuMode = 'kernel';
    this.saveContext();
    this.emit('isr_enter', { line });
    this.act('pic');
    const cycles =
      line === 'disk' ? ISR_DISK_CYCLES : line === 'timer' ? ISR_TIMER_CYCLES : ISR_KBD_CYCLES;
    this.kernelTask = {
      kind: line === 'disk' ? 'isr-disk' : line === 'timer' ? 'isr-timer' : 'isr-kbd',
      cyclesLeft: cycles,
      data: {}
    };
  }

  private enterKernelFromTrap(): void {
    const trap = this.trapPending!;
    this.trapPending = null;
    this.cpuMode = 'kernel';
    this.saveContext();
    this.emit('kernel_enter', { pid: trap.pid });
    if (trap.kind === 'sys') {
      this.emit('syscall_enter', { pid: trap.pid, sys: trap.sys });
      this.act('gate');
      this.tl('sys', 'tl_sys', { pid: trap.pid, a: trap.sys });
      if (this.trace.mode === 'syscall') {
        this.traceSysPid = trap.pid;
        this.traceStep('tr_sys_mode', { pid: trap.pid, sys: trap.sys });
        this.traceStep('tr_sys_ivt', { pid: trap.pid });
        this.traceStep('tr_sys_handler', { pid: trap.pid, sys: trap.sys });
      }
      const cycles =
        trap.sys === 'exit' ? 20 : trap.sys === 'write' || trap.sys === 'read' ? 16 : trap.sys === 'sleep' ? 6 : 8;
      this.kernelTask = { kind: 'syscall', cyclesLeft: cycles, data: { sys: trap.sys, pid: trap.pid } };
    } else {
      this.kernelTask = { kind: 'fault', cyclesLeft: 8, data: { pid: trap.pid, vpn: trap.vpn } };
    }
  }

  // ---------- 系统调用 ----------

  private handleSyscall(sys: SysName, pid: number): void {
    const proc = this.procOf(pid);
    const endTrace = (key: string) => {
      if (this.trace.mode === 'syscall' && pid === this.traceSysPid) {
        this.traceStep(key, { pid });
        this.traceStep('tr_sys_done', { pid });
        this.trace.mode = null;
      }
    };
    switch (sys) {
      case 'write': {
        if (!proc) break;
        if (this.trace.mode === 'syscall') this.traceStep('tr_sys_write', { pid });
        let frame = -1;
        let block = -1;
        for (const vpn of proc.wsPages) {
          const pte = this.getPteOf(pid, vpn);
          if (pte && pte.present) {
            frame = pte.pfn;
            block = pte.diskBlock;
            break;
          }
        }
        proc.ioOps++;
        this.blockProc(proc, 'io');
        this.tl('block', 'tl_io_block', { pid });
        if (frame >= 0 && block >= 0) {
          this.flushPFN(frame);
          this.enqueueDma({ kind: 'write', block, frame, tag: { type: 'io', wake: pid } });
        }
        this.emit('syscall_exit', { pid });
        this.afterKernelTask();
        break;
      }
      case 'read': {
        if (!proc) break;
        if (this.trace.mode === 'syscall') this.traceStep('tr_sys_read', { pid });
        proc.ioOps++;
        this.blockProc(proc, 'io');
        this.tl('block', 'tl_io_block', { pid });
        const codePte = this.getPteOf(pid, 0);
        if (codePte) {
          this.enqueueDma({ kind: 'read', block: codePte.diskBlock, frame: 6, tag: { type: 'io', wake: pid } });
        }
        this.emit('syscall_exit', { pid });
        this.afterKernelTask();
        break;
      }
      case 'sleep': {
        if (!proc) break;
        this.blockProc(proc, 'sleep', undefined, this.cycle + 600);
        this.tl('block', 'tl_sleep', { pid });
        this.emit('syscall_exit', { pid });
        endTrace('tr_sys_return');
        this.afterKernelTask();
        break;
      }
      case 'yield': {
        if (this.trace.mode === 'syscall') this.traceStep('tr_sys_yield', { pid });
        this.emit('syscall_exit', { pid });
        this.schedule(true);
        endTrace('tr_sys_return');
        break;
      }
      case 'p0':
      case 'p1': {
        const sem = this.sems[sys === 'p0' ? 0 : 1];
        this.emit('sem_p', { pid, num: sem.id });
        if (sem.value > 0) {
          sem.value = 0;
          sem.owner = pid;
          if (this.trace.mode === 'syscall') this.traceStep('tr_sys_sem_ok', { pid });
        } else if (proc) {
          this.blockProc(proc, 'sem', sem.id);
          sem.waiters.push(pid);
          this.emit('sem_block', { pid, num: sem.id });
          this.tl('sem', 'tl_sem_block', { pid, num: sem.id });
          if (this.trace.mode === 'syscall') this.traceStep('tr_sys_sem_block', { pid });
          this.checkDeadlock();
        }
        this.emit('syscall_exit', { pid });
        endTrace('tr_sys_return');
        this.afterKernelTask();
        break;
      }
      case 'v0':
      case 'v1': {
        const sem = this.sems[sys === 'v0' ? 0 : 1];
        this.emit('sem_v', { pid, num: sem.id });
        const waiter = sem.waiters.shift();
        if (waiter !== undefined) {
          sem.owner = waiter;
          this.emit('sem_wake', { pid: waiter, num: sem.id });
          this.tl('sem', 'tl_sem_wake', { pid: waiter, num: sem.id });
          this.wakeProcess(waiter, 'sem');
        } else {
          sem.value = 1;
          sem.owner = -1;
        }
        this.emit('syscall_exit', { pid });
        endTrace('tr_sys_return');
        this.afterKernelTask();
        break;
      }
      case 'exit': {
        if (this.trace.mode === 'syscall') this.traceStep('tr_sys_exit', { pid });
        this.reclaimProcess(pid);
        this.emit('syscall_exit', { pid });
        endTrace('tr_sys_end_exit');
        this.afterKernelTask();
        break;
      }
      default:
        this.emit('syscall_exit', { pid });
        this.afterKernelTask();
        break;
    }
  }

  private checkDeadlock(): void {
    if (this.deadlockFlag) return;
    const owners = new Map<number, number>();
    for (const s of this.sems) {
      if (s.value === 0 && s.owner >= 0) owners.set(s.id, s.owner);
    }
    if (detectDeadlock(this.procs, owners)) {
      this.deadlockFlag = true;
      this.emit('deadlock');
      this.tl('deadlock', 'tl_deadlock');
    }
  }

  private wakeProcess(pid: number, fromKind: 'io' | 'sem' | 'page' | 'sleep'): void {
    const proc = this.procOf(pid);
    if (!proc || proc.state !== 'blocked') return;
    if (proc.blockOn && proc.blockOn.kind !== fromKind) return;
    proc.state = 'ready';
    proc.blockOn = null;
    proc.waitTime = this.cycle;
    this.readyQueue.push(pid);
    this.emit('proc_wake', { pid });
    this.tl('wake', 'tl_wake', { pid });
    const cur = this.currentProc();
    if (
      cur &&
      cur.state === 'running' &&
      this.cpuMode === 'user' &&
      !this.kernelTask &&
      shouldPreemptPrio(this.cfg.algo, cur, this.readyPCBs())
    ) {
      this.tl('preempt', 'tl_preempt_prio', { pid: cur.pid });
      this.saveContext();
      this.schedule(true);
    } else if (
      !this.kernelTask &&
      this.cpuMode === 'user' &&
      !this.currentPid &&
      !this.shutdown
    ) {
      this.schedule(false);
    }
  }

  // ---------- 调度 ----------

  private readyPCBs(): PCB[] {
    const out: PCB[] = [];
    for (const pid of this.readyQueue) {
      const p = this.procs.find((q) => q.pid === pid);
      if (p) out.push(p);
    }
    return out;
  }

  currentProc(): PCB | null {
    if (this.currentPid === null) return null;
    const p = this.procs.find((q) => q.pid === this.currentPid);
    return p && p.state === 'running' ? p : null;
  }

  procOf(pid: number): PCB | null {
    return this.procs.find((p) => p.pid === pid) ?? null;
  }

  private saveContext(): void {
    let proc = this.currentProc();
    if (!proc && this.currentPid !== null) proc = this.procOf(this.currentPid);
    if (proc) {
      proc.regs = [...this.regs];
      proc.pc = this.pc;
    }
  }

  private restoreContext(pcb: PCB): void {
    this.regs = [...pcb.regs];
    this.pc = pcb.pc;
    this.quantumUsed = 0;
    this.fetchExhausted = false;
  }

  private schedule(preempt: boolean): void {
    if (this.kernelTask) return;
    if (this.shutdown && this.shutdown.stage !== 'finish') return;
    const cur = this.currentProc();
    const curPid = this.currentPid;
    if (cur && cur.state === 'running') {
      if (!preempt && !shouldPreemptPrio(this.cfg.algo, cur, this.readyPCBs())) {
        this.cpuMode = 'user';
        return;
      }
      if (this.cpuMode === 'user') this.saveContext();
      cur.state = 'ready';
      cur.waitTime = this.cycle;
      this.readyQueue.push(cur.pid);
      this.currentPid = null;
    }
    const next = pickNext(this.cfg.algo, this.readyPCBs());
    if (!next) {
      this.cpuMode = 'user';
      this.currentPid = null;
      return;
    }
    this.readyQueue = this.readyQueue.filter((p) => p !== next.pid);
    next.state = 'running';
    if (next.start < 0) next.start = this.cycle;
    this.act('sched');
    this.emit('sched_pick', { pid: next.pid });
    this.tl('sched', 'tl_pick', { pid: next.pid, a: this.cfg.algo });
    if (next.pid === curPid) {
      this.currentPid = next.pid;
      this.restoreContext(next);
      this.cpuMode = 'user';
      return;
    }
    if (curPid !== null) this.emit('ctx_save', { pid: curPid });
    this.kernelTask = { kind: 'switch', cyclesLeft: CTX_SWITCH_COST, data: { from: curPid ?? -1, to: next.pid } };
    this.cpuMode = 'kernel';
  }

  // ---------- 进程生命周期 ----------

  private startLoader(): void {
    const job = this.pendingSpawns.shift();
    if (!job) return;
    this.kernelTask = { kind: 'loader', cyclesLeft: 40, data: { role: job.role, prio: job.prio } };
    this.cpuMode = 'kernel';
  }

  private createProcess(role: ProcRole, prio?: number): void {
    if (this.procs.filter((p) => p.state !== 'terminated').length >= MAX_PROCS) return;
    const pid = this.nextPid++;
    const prog = buildProgram(role, this.rng);
    const file = `proc${pid}.bin`;
    const inode = this.fs.alloc(file, 1 + prog.wsPages.length, 'proc');
    if (!inode) {
      this.tl('load', 'tl_disk_full');
      return;
    }
    // 页表作为内核元数据管理(教学简化:不占用用户页框)
    const pt = newPageTable(-1);
    const mapPage = (vpn: number, diskBlock: number) => {
      setPTE(pt, vpn, { present: false, dirty: false, pfn: -1, diskBlock }, () => -1);
    };
    mapPage(0, inode.blocks[0]);
    prog.wsPages.forEach((vpn, i) => mapPage(vpn, inode.blocks[i + 1]));
    const priority =
      prio ??
      (role === 'daemon'
        ? 1
        : role === 'starveLow'
          ? 5
          : role === 'deadA' || role === 'deadB'
            ? 2
            : 3);
    const pcb: PCB = {
      pid,
      name: `P${pid}`,
      role,
      state: 'ready',
      pc: 0,
      regs: new Array(8).fill(0),
      priority,
      burstEstimate: prog.estimate,
      burstRemaining: prog.estimate,
      arrival: this.cycle,
      start: -1,
      finish: -1,
      cpuTime: 0,
      waitTime: this.cycle,
      faults: 0,
      ioOps: 0,
      wsPages: prog.wsPages,
      file,
      blockOn: null
    };
    this.procs.push(pcb);
    this.programs.set(pid, prog.instrs);
    this.pageTables.set(pid, pt);
    this.readyQueue.push(pid);
    this.counters.spawns++;
    this.emit('proc_create', { pid });
    this.emit('proc_ready', { pid });
    this.tl('load', 'tl_load', { pid, a: role });
  }

  private freeFrame(pfn: number): void {
    this.frames[pfn] = { state: 'free', pid: -1, dirty: false };
    this.frameMap[pfn] = null;
    this.framePending[pfn] = false;
    this.emit('frame_free', { pfn });
  }

  private reclaimProcess(pid: number): void {
    const proc = this.procOf(pid);
    if (!proc || proc.state === 'terminated') return;
    const pt = this.pageTables.get(pid);
    for (let i = KERNEL_FRAMES; i < this.frames.length; i++) {
      const m = this.frameMap[i];
      if (m && m.pid === pid) {
        this.invalidateFrameCaches(i);
        this.freeFrame(i);
      }
    }
    if (pt) {
      if (pt.l1Frame >= 0) this.freeFrame(pt.l1Frame);
      for (const l2 of pt.l2) {
        if (l2 && l2.frame >= 0) this.freeFrame(l2.frame);
      }
    }
    this.tlb.flushPID(pid);
    if (proc.file) {
      const inode = this.fs.byName(proc.file);
      if (inode) this.fs.free(inode);
    }
    proc.state = 'terminated';
    proc.finish = this.cycle;
    proc.blockOn = null;
    this.readyQueue = this.readyQueue.filter((p) => p !== pid);
    if (this.currentPid === pid) this.currentPid = null;
    const turnaround = proc.finish - proc.arrival;
    this.turnarounds.push(turnaround);
    if (this.turnarounds.length > 16) this.turnarounds.shift();
    this.metrics.avgTurnaround =
      this.turnarounds.reduce((a, b) => a + b, 0) / this.turnarounds.length;
    this.win.finished++;
    this.emit('proc_exit', { pid });
    this.tl('exit', 'tl_exit', { pid });
    this.programs.delete(pid);
    this.pageTables.delete(pid);
  }

  // ---------- 引导 ----------

  private advanceBoot(): void {
    this.bootIdx++;
    if (this.bootIdx >= BOOT_PLAN.length) {
      this.bootStage = 'done';
      this.emit('boot_done');
      this.tl('boot', 'tl_boot_done');
      this.cpuMode = 'kernel';
      if (this.cfg.autoSpawn !== false) {
        this.pendingSpawns.push({ role: 'compute' }, { role: 'mixed' });
      }
      this.startLoader();
      if (!this.kernelTask) this.cpuMode = 'user';
      return;
    }
    const item = BOOT_PLAN[this.bootIdx];
    this.bootStage = item.stage;
    if (item.cycles > 0) {
      this.bootLeft = item.cycles;
      if (item.stage.startsWith('post')) this.emit('post_stage', { text: item.stage });
      else this.emit('kinit', { text: item.stage });
    } else {
      this.bootLeft = 0;
      this.enqueueDma({ kind: 'read', block: item.block, frame: item.frame, tag: { type: 'boot' } });
      if (item.stage === 'bootloader') {
        this.emit('bootloader', { num: item.block });
        this.tl('boot', 'tl_bootloader');
      } else {
        this.emit('kernel_load', { num: item.block });
        this.tl('boot', 'tl_kernel_load');
      }
    }
  }

  // ---------- 停机 ----------

  private shutdownNext(): void {
    if (!this.shutdown) return;
    switch (this.shutdown.stage) {
      case 'reclaim': {
        const alive = this.procs.find((p) => p.state !== 'terminated');
        if (alive) {
          this.kernelTask = { kind: 'shutdown', cyclesLeft: 15, data: { sub: 'reclaim', pid: alive.pid } };
        } else {
          this.shutdown.stage = 'checkpoint';
          this.shutdownNext();
        }
        break;
      }
      case 'checkpoint': {
        this.cpuMode = 'kernel';
        const old = this.fs.byName('checkpoint.img');
        if (old) this.fs.free(old);
        const inode = this.fs.alloc('checkpoint.img', 1, 'checkpoint');
        if (inode) {
          this.enqueueDma({ kind: 'write', block: inode.blocks[0], frame: 7, tag: { type: 'checkpoint' } });
          this.emit('shutdown_stage', { text: 'checkpoint' });
        } else {
          this.shutdown.stage = 'cooldown';
          this.kernelTask = { kind: 'shutdown', cyclesLeft: 140, data: { sub: 'cooldown' } };
        }
        break;
      }
      case 'cooldown':
        if (!this.kernelTask) {
          this.kernelTask = { kind: 'shutdown', cyclesLeft: 140, data: { sub: 'cooldown' } };
        }
        break;
      case 'clock-stop':
        this.kernelTask = { kind: 'shutdown', cyclesLeft: 40, data: { sub: 'clock-stop' } };
        break;
      case 'bus-off':
        this.kernelTask = { kind: 'shutdown', cyclesLeft: 40, data: { sub: 'bus-off' } };
        break;
      default:
        break;
    }
  }

  private finishShutdownTask(sub: string): void {
    if (!this.shutdown) return;
    switch (sub) {
      case 'reclaim':
        this.shutdownNext();
        break;
      case 'cooldown':
        this.shutdown.stage = 'clock-stop';
        this.emit('shutdown_stage', { text: 'cooldown-done' });
        this.shutdownNext();
        break;
      case 'clock-stop':
        this.clockEnabled = false;
        this.emit('clock_stop');
        this.tl('shutdown', 'tl_clock_stop');
        this.shutdown.stage = 'bus-off';
        this.shutdownNext();
        break;
      case 'bus-off':
        this.busEnabled = false;
        this.emit('shutdown_stage', { text: 'bus-off' });
        this.tl('shutdown', 'tl_bus_off');
        this.power = false;
        this.shutdown = null;
        this.phase = 'idle';
        this.emit('power_off');
        break;
      default:
        break;
    }
  }

  // ---------- 指标 ----------

  private metricWindow(): void {
    const total = this.win.user + this.win.kernel + this.win.idle;
    // CPU 利用率 = 用户态有效执行周期占比(内核换页/中断处理计入分母)
    const util = total > 0 ? this.win.user / total : 0;
    const cacheDeltaHits = this.l1i.hits + this.l1d.hits - this.prev.cacheHits;
    const cacheDeltaMisses = this.l1i.misses + this.l1d.misses - this.prev.cacheMisses;
    const cacheTotal = cacheDeltaHits + cacheDeltaMisses;
    const cacheHit = cacheTotal > 0 ? cacheDeltaHits / cacheTotal : this.metrics.cacheHit;
    const faultRate =
      this.win.memAccesses > 0 ? this.win.faults / this.win.memAccesses : this.metrics.faultRate;
    this.prev.cacheHits = this.l1i.hits + this.l1d.hits;
    this.prev.cacheMisses = this.l1i.misses + this.l1d.misses;
    this.metrics.cpuUtil = this.metrics.cpuUtil * 0.85 + util * 0.15;
    this.metrics.cacheHit = this.metrics.cacheHit * 0.85 + cacheHit * 0.15;
    this.metrics.faultRate = this.metrics.faultRate * 0.85 + faultRate * 0.15;
    this.metrics.throughput = this.metrics.throughput * 0.9 + ((this.win.finished * 10000) / 60) * 0.1;
    const allocated = this.frames.filter((f) => f.state !== 'free').length;
    this.metrics.memUsage = this.frames.length > 0 ? allocated / this.frames.length : 0;
    this.metrics.seriesCpu.push(this.metrics.cpuUtil);
    this.metrics.seriesCache.push(this.metrics.cacheHit);
    this.metrics.seriesFault.push(this.metrics.faultRate);
    for (const s of [this.metrics.seriesCpu, this.metrics.seriesCache, this.metrics.seriesFault]) {
      if (s.length > 240) s.shift();
    }
    for (const k of Object.keys(this.heat) as PartId[]) {
      const raw = Math.min(1, this.heatAcc[k] / 60);
      this.heat[k] = this.heat[k] * 0.8 + raw * 0.2;
      this.heatAcc[k] = 0;
    }
    this.win = { user: 0, kernel: 0, idle: 0, faults: 0, memAccesses: 0, finished: 0 };
    this.emit('metric_window');
  }

  // ---------- 快照 ----------

  snapshot() {
    const stages = [
      { key: 'if', cell: this.pipeIf, tx: this.ifTx },
      { key: 'id', cell: this.pipeId, tx: null },
      { key: 'ex', cell: this.pipeEx, tx: null },
      { key: 'mem', cell: this.pipeMem, tx: this.memTx },
      { key: 'wb', cell: this.pipeWb, tx: null }
    ].map((s) => ({
      key: s.key,
      pid: s.cell?.pid ?? -1,
      text: s.cell ? instrText(s.cell.instr) : '',
      pc: s.cell?.pc ?? -1,
      active: s.cell !== null || s.tx !== null,
      busy: s.tx !== null
    }));
    return {
      cycle: this.cycle,
      power: this.power,
      suspended: this.suspended,
      phase: this.phase,
      cpuMode: this.cpuMode,
      freq: this.freq,
      temp: this.temp,
      deadlock: this.deadlockFlag,
      bootStage: this.bootStage,
      shutdownStage: this.shutdown?.stage ?? null,
      currentPid: this.currentPid,
      quantumUsed: this.quantumUsed,
      quantum: this.cfg.quantum,
      algo: this.cfg.algo,
      cfg: { ...this.cfg },
      pipeline: stages,
      regs: [...this.regs],
      pc: this.pc,
      tlb: this.tlb.entries.map((e) => ({ ...e })),
      caches: [
        { level: 'l1i', ...this.cacheInfo(this.l1i) },
        { level: 'l1d', ...this.cacheInfo(this.l1d) },
        { level: 'l2', ...this.cacheInfo(this.l2) },
        { level: 'l3', ...this.cacheInfo(this.l3) }
      ],
      frames: this.frames.map((f) => ({ ...f })),
      frameMap: this.frameMap.map((m) => (m ? { ...m } : null)),
      readyQueue: [...this.readyQueue],
      procs: this.procs.map((p) => ({
        pid: p.pid,
        name: p.name,
        role: p.role,
        state: p.state,
        priority: p.priority,
        burstRemaining: p.burstRemaining,
        arrival: p.arrival,
        start: p.start,
        finish: p.finish,
        cpuTime: p.cpuTime,
        waitTime: p.waitTime,
        faults: p.faults,
        ioOps: p.ioOps,
        blockOn: p.blockOn ? p.blockOn.kind : null
      })),
      sems: this.sems.map((s) => ({ id: s.id, value: s.value, owner: s.owner, waiters: [...s.waiters] })),
      disk: {
        used: this.fs.usedCount(),
        total: this.fs.used.length,
        reads: this.fs.reads,
        writes: this.fs.writes,
        files: this.fs.inodes.map((i) => ({ name: i.name, blocks: i.blocks.length, kind: i.kind }))
      },
      dma: {
        active: this.dmaActive
          ? { kind: this.dmaActive.kind, block: this.dmaActive.block, frame: this.dmaActive.frame }
          : null,
        queued: this.dmaQueue.length
      },
      metrics: {
        cpuUtil: this.metrics.cpuUtil,
        cacheHit: this.metrics.cacheHit,
        faultRate: this.metrics.faultRate,
        ctxSwitches: this.counters.ctxSwitches,
        avgTurnaround: this.metrics.avgTurnaround,
        throughput: this.metrics.throughput,
        memUsage: this.metrics.memUsage,
        instructions: this.counters.instructions
      },
      heat: { ...this.heat },
      series: {
        cpu: [...this.metrics.seriesCpu],
        cache: [...this.metrics.seriesCache],
        fault: [...this.metrics.seriesFault]
      },
      timeline: this.timeline.slice(-40),
      counters: { ...this.counters },
      trace: {
        mode: this.trace.mode,
        steps: this.trace.steps.slice(-8).map((s) => ({ ...s }))
      }
    };
  }

  private cacheInfo(c: CacheModel) {
    const total = c.hits + c.misses;
    return {
      size: c.size,
      hits: c.hits,
      misses: c.misses,
      writebacks: c.writebacks,
      occupancy: c.occupancy(),
      hitRate: total > 0 ? c.hits / total : 0
    };
  }
}

export const sim = new Sim();
