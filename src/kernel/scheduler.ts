// 调度器:FCFS / SJF / RR / 优先级(抢占)
import type { PCB, SchedAlgo } from './types';

export const CTX_SWITCH_COST = 30; // 上下文切换开销(周期)
export const TIMER_PERIOD = 500; // 时钟中断周期
export const ISR_TIMER_CYCLES = 18;
export const ISR_DISK_CYCLES = 12;
export const ISR_KBD_CYCLES = 12;

/** 从就绪队列选下一个进程(队列即 FIFO 顺序) */
export function pickNext(algo: SchedAlgo, ready: PCB[]): PCB | null {
  if (ready.length === 0) return null;
  switch (algo) {
    case 'sjf':
      return [...ready].sort(
        (a, b) => a.burstRemaining - b.burstRemaining || a.pid - b.pid
      )[0];
    case 'prio':
      return [...ready].sort(
        (a, b) => a.priority - b.priority || a.pid - b.pid
      )[0];
    case 'fcfs':
    case 'rr':
    default:
      return ready[0];
  }
}

/** 优先级调度:是否应抢占当前进程 */
export function shouldPreemptPrio(algo: SchedAlgo, current: PCB, ready: PCB[]): boolean {
  if (algo !== 'prio' || !current) return false;
  return ready.some((p) => p.priority < current.priority);
}

/** 判断死锁:信号量等待图中找环 */
export function detectDeadlock(
  procs: PCB[],
  semOwners: Map<number, number>
): boolean {
  // semOwners: semId → 持有者 pid;等待边: pid → 想要的 semId
  for (const p of procs) {
    if (p.state !== 'blocked' || p.blockOn?.kind !== 'sem') continue;
    const visited = new Set<number>();
    let cur: PCB | undefined = p;
    while (cur) {
      if (visited.has(cur.pid)) return true;
      visited.add(cur.pid);
      const want = cur.blockOn?.semId;
      if (want === undefined) break;
      const ownerPid = semOwners.get(want);
      if (ownerPid === undefined) break;
      cur = procs.find((q) => q.pid === ownerPid && q.state === 'blocked');
      if (!cur) break;
    }
  }
  return false;
}
