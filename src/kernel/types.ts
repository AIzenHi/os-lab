// 共享类型:模拟内核的公共数据结构
export type Phase =
  | 'idle' // 空闲(关机)
  | 'boot' // 开机引导(自检+引导+内核初始化)
  | 'load' // 进程装载
  | 'ready' // 就绪排队(调度决策)
  | 'exec' // CPU 执行
  | 'mem' // 访存与缺页
  | 'io' // I/O 阻塞
  | 'ctx' // 上下文切换
  | 'intr' // 中断处理
  | 'halt'; // 停机

export type SchedAlgo = 'fcfs' | 'sjf' | 'rr' | 'prio';

export interface SimConfig {
  algo: SchedAlgo;
  quantum: number; // 时间片(周期)
  l1Lines: number; // L1 缓存行数(L2=×4,L3=×16)
  frames: number; // 物理页框总数
  speed: number; // 速度倍率
  seed: number;
  autoSpawn?: boolean; // 引导后是否自动装载初始进程(测试/场景用)
}

export type EvKind =
  | 'power_on'
  | 'power_off'
  | 'post_stage'
  | 'bootloader'
  | 'kernel_load'
  | 'kinit'
  | 'boot_done'
  | 'proc_create'
  | 'proc_ready'
  | 'proc_run'
  | 'proc_block'
  | 'proc_wake'
  | 'proc_exit'
  | 'sched_pick'
  | 'quantum_end'
  | 'ctx_save'
  | 'ctx_load'
  | 'ifetch'
  | 'alu'
  | 'branch'
  | 'branch_flush'
  | 'stall'
  | 'tlb_hit'
  | 'tlb_miss'
  | 'pt_walk'
  | 'page_fault'
  | 'fault_evict'
  | 'fault_writeback'
  | 'fault_read'
  | 'fault_done'
  | 'cache_hit'
  | 'cache_miss'
  | 'cache_fill'
  | 'cache_writeback'
  | 'frame_alloc'
  | 'frame_free'
  | 'disk_read'
  | 'disk_write'
  | 'dma_start'
  | 'dma_done'
  | 'bus_transfer'
  | 'int_timer'
  | 'int_disk'
  | 'int_kbd'
  | 'isr_enter'
  | 'isr_exit'
  | 'kernel_enter'
  | 'kernel_exit'
  | 'syscall_enter'
  | 'syscall_exit'
  | 'sem_p'
  | 'sem_v'
  | 'sem_block'
  | 'sem_wake'
  | 'deadlock'
  | 'clock_stop'
  | 'freq_change'
  | 'checkpoint'
  | 'shutdown_stage'
  | 'suspend'
  | 'resume'
  | 'trace_step'
  | 'metric_window';

export interface SimEvent {
  t: number;
  kind: EvKind;
  pid?: number;
  va?: number;
  pa?: number;
  vpn?: number;
  pfn?: number;
  level?: 'l1i' | 'l1d' | 'l2' | 'l3' | 'dram';
  sys?: string;
  line?: 'timer' | 'disk' | 'kbd';
  text?: string; // trace 叙述键
  num?: number;
}

export type TlKind =
  | 'boot'
  | 'load'
  | 'sched'
  | 'preempt'
  | 'block'
  | 'wake'
  | 'exit'
  | 'fault'
  | 'int'
  | 'sys'
  | 'sem'
  | 'shutdown'
  | 'suspend'
  | 'checkpoint'
  | 'deadlock';

export interface TimelineEntry {
  t: number;
  kind: TlKind;
  pid?: number;
  key: string; // i18n 键
  a?: string;
  b?: string;
  num?: number;
}

export type ProcRole =
  | 'compute'
  | 'io'
  | 'mixed'
  | 'deadA'
  | 'deadB'
  | 'starveLow'
  | 'daemon'
  | 'thrash';

export type ProcState = 'new' | 'ready' | 'running' | 'blocked' | 'terminated';

export interface PCB {
  pid: number;
  name: string;
  role: ProcRole;
  state: ProcState;
  pc: number;
  regs: number[];
  priority: number; // 1 最高
  burstEstimate: number; // 预计动态指令数(SJF 用)
  burstRemaining: number;
  arrival: number;
  start: number;
  finish: number;
  cpuTime: number;
  waitTime: number; // 最近一次入就绪队列的时间
  faults: number;
  ioOps: number;
  wsPages: number[]; // 工作集虚拟页号
  file?: string; // 程序文件名(inode)
  blockOn: { kind: 'io' | 'sem' | 'page' | 'sleep'; semId?: number; until?: number } | null;
}
