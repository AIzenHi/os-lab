// 内核测试:启动引导 / 调度参数 / 访存缺页 / 停机 / 故障场景 / 确定性
import { describe, expect, it } from 'vitest';
import { CYCLES_PER_SEC, Sim } from '../src/kernel/sim';
import { CacheModel } from '../src/kernel/cache';
import type { SimConfig } from '../src/kernel/types';

const base: SimConfig = {
  algo: 'rr',
  quantum: 800,
  l1Lines: 16,
  frames: 48,
  speed: 1,
  seed: 20260829,
  autoSpawn: false
};

function make(over: Partial<SimConfig> = {}): Sim {
  return new Sim({ ...base, ...over });
}

function run(sim: Sim, cycles: number): void {
  sim.advance(cycles / CYCLES_PER_SEC, 1);
}

/** 上电并等待引导完成 */
function booted(over: Partial<SimConfig> = {}): Sim {
  const s = make(over);
  s.powerOn();
  run(s, 1500);
  return s;
}

function runUntil(sim: Sim, cond: () => boolean, maxCycles: number): boolean {
  let n = maxCycles;
  while (n-- > 0) {
    run(sim, 1);
    if (cond()) return true;
  }
  return false;
}

describe('启动引导', () => {
  it('关机状态为 idle,上电后进入 boot', () => {
    const s = make();
    expect(s.phase).toBe('idle');
    expect(s.powerOn()).toBe(true);
    expect(s.power).toBe(true);
    expect(s.phase).toBe('boot');
    expect(s.bootStage).toBe('post-cpu');
  });

  it('完整走完自检 → 引导装载 → 内核初始化,并自动装载进程进入运行', () => {
    const s = new Sim({ ...base, autoSpawn: true });
    s.powerOn();
    run(s, 4000);
    expect(s.bootStage).toBe('done');
    expect(s.procs.length).toBeGreaterThanOrEqual(2);
    expect(['exec', 'mem', 'intr', 'ctx', 'io', 'ready', 'load']).toContain(s.phase);
    expect(s.frames[0].state).toBe('kernel');
    expect(s.counters.instructions).toBeGreaterThan(50);
  });

  it('引导期间从磁盘 DMA 读取引导扇区与内核映像', () => {
    const s = new Sim({ ...base, autoSpawn: true });
    s.powerOn();
    run(s, 1200);
    const kinds = s.drainEvents().map((e) => e.kind);
    expect(kinds).toContain('bootloader');
    expect(kinds).toContain('kernel_load');
    expect(kinds).toContain('dma_done');
    expect(kinds).toContain('kinit');
    expect(kinds).toContain('boot_done');
  });
});

describe('调度参数', () => {
  it('RR 短时间片的上下文切换次数多于长时间片', () => {
    const runWith = (quantum: number) => {
      const s = booted({ quantum });
      s.spawnProcess('compute');
      s.spawnProcess('compute');
      run(s, 6000);
      return s.counters.ctxSwitches;
    };
    const short = runWith(80);
    const long = runWith(3000);
    expect(short).toBeGreaterThan(long);
    expect(short).toBeGreaterThan(10);
  });

  it('FCFS 运行到阻塞/退出才切换,时间片不触发抢占', () => {
    const s = booted({ algo: 'fcfs', quantum: 60 });
    s.spawnProcess('compute');
    s.spawnProcess('compute');
    const done = runUntil(s, () => s.procs.every((p) => p.state === 'terminated'), 60000);
    expect(done).toBe(true);
  });

  it('进程退出会回收页框与页表帧,内存占用回落', () => {
    const s = booted();
    s.spawnProcess('compute');
    s.spawnProcess('mixed');
    const usedDuring = () => s.frames.filter((f) => f.state !== 'free').length;
    let peak = 0;
    runUntil(
      s,
      () => {
        peak = Math.max(peak, usedDuring());
        return s.procs.length > 0 && s.procs.every((p) => p.state === 'terminated');
      },
      60000
    );
    expect(peak).toBeGreaterThan(10);
    expect(usedDuring()).toBe(8); // 只剩内核保留帧
  });
});

describe('访存与地址翻译', () => {
  it('虚拟地址经页表翻译映射到唯一物理页框(一一对应)', () => {
    const s = booted();
    s.spawnProcess('compute');
    run(s, 6000);
    const seenPte = new Set<string>();
    const seenPfn = new Set<number>();
    let mapped = 0;
    for (let pfn = 8; pfn < s.frames.length; pfn++) {
      const m = s.frameMap[pfn];
      if (!m) continue;
      const key = `${m.pid}:${m.vpn}`;
      expect(seenPte.has(key)).toBe(false);
      seenPte.add(key);
      expect(seenPfn.has(pfn)).toBe(false);
      seenPfn.add(pfn);
      mapped++;
    }
    expect(mapped).toBeGreaterThan(3);
  });

  it('缺页触发换入,完成后 PTE 驻留并写入 TLB', () => {
    const s = booted();
    s.spawnProcess('compute');
    run(s, 5000);
    expect(s.counters.faults).toBeGreaterThan(2);
    expect(s.counters.tlbHits + s.counters.tlbMisses).toBeGreaterThan(10);
    expect(s.counters.tlbHits).toBeGreaterThan(0);
    expect(s.frames.filter((f) => f.state === 'user').length).toBeGreaterThan(0);
  });

  it('同一访问序列下缓存命中与缺失统计自洽(命中率 0..1)', () => {
    const s = booted();
    s.spawnProcess('compute');
    run(s, 8000);
    const total = s.counters.cacheHits + s.counters.cacheMisses;
    expect(total).toBeGreaterThan(20);
    const rate = s.counters.cacheHits / total;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it('缓存容量调大后命中率上升(CacheModel 直接验证)', () => {
    // 32 块循环扫描:8 行直接映射缓存每圈逐出全部行,32 行可整圈容纳
    const sweep = (size: number) => {
      const c = new CacheModel(size);
      for (let round = 0; round < 4; round++) {
        for (let block = 0; block < 32; block++) {
          c.access(block * 32, false, round * 32 + block);
        }
      }
      return c.hits / (c.hits + c.misses);
    };
    const small = sweep(8);
    const big = sweep(32);
    expect(small).toBeLessThan(0.1);
    expect(big).toBeGreaterThan(0.6);
    expect(big).toBeGreaterThan(small);
  });

  it('缓存容量配置即时生效(重建缓存并清空 TLB)', () => {
    const s = booted({ l1Lines: 8 });
    expect(s.l1d.size).toBe(8);
    s.setConfig({ l1Lines: 32 });
    expect(s.l1d.size).toBe(32);
    expect(s.l2.size).toBe(128);
    expect(s.l3.size).toBe(512);
  });

  it('计算进程按程序完整执行(约 730 条动态指令)', () => {
    const s = booted();
    s.spawnProcess('compute');
    runUntil(s, () => s.procs.length > 0 && s.procs[0].state === 'terminated', 60000);
    expect(s.counters.instructions).toBeGreaterThan(650);
    expect(s.counters.instructions).toBeLessThan(850);
  });

  it('时间片过短时有效执行效率下降(切换开销占比上升)', () => {
    const runWith = (quantum: number) => {
      const s = booted({ quantum });
      s.spawnProcess('compute');
      s.spawnProcess('compute');
      run(s, 6000);
      return s.counters.instructions / Math.max(1, s.counters.ctxSwitches);
    };
    // 每次切换平均换来的指令数:长片明显更多
    expect(runWith(2000)).toBeGreaterThan(runWith(40));
  });
});

describe('停机序列', () => {
  it('停机:完成当前时间片 → 回收 → 检查点 → 降频 → 时钟停摆 → 总线断流 → 关机', () => {
    const s = booted();
    s.spawnProcess('compute');
    run(s, 3000);
    expect(s.requestShutdown()).toBe(true);
    const stages = new Set<string>();
    let guard = 0;
    while (s.power && guard++ < 40000) {
      run(s, 1);
      if (s.shutdown) stages.add(s.shutdown.stage);
    }
    expect(s.power).toBe(false);
    expect(stages.has('reclaim')).toBe(true);
    expect(stages.has('cooldown')).toBe(true);
    expect(stages.has('clock-stop')).toBe(true);
    expect(stages.has('bus-off')).toBe(true);
    expect(s.clockEnabled).toBe(false);
    expect(s.busEnabled).toBe(false);
    expect(s.freq).toBeLessThan(0.2);
    expect(s.fs.byName('checkpoint.img')).toBeDefined();
  });
});

describe('故障挑战场景', () => {
  it('死锁:两进程交叉持有信号量互相等待,检测到环路', () => {
    const s = booted({ quantum: 40 });
    s.spawnProcess('deadA');
    s.spawnProcess('deadB');
    const found = runUntil(s, () => s.deadlockFlag, 30000);
    expect(found).toBe(true);
    expect(s.counters.deadlocks).toBe(1);
    expect(s.procs.filter((p) => p.state === 'blocked').length).toBe(2);
  });

  it('内存颠簸:页框不足时缺页风暴、CPU 有效利用率崩塌、指令几乎无法推进', () => {
    const s = booted({ frames: 12, quantum: 600 });
    s.spawnProcess('thrash');
    s.spawnProcess('thrash');
    s.spawnProcess('thrash');
    let peakFaultRate = 0;
    let minUtil = 1;
    for (let k = 0; k < 10; k++) {
      run(s, 2500);
      peakFaultRate = Math.max(peakFaultRate, s.metrics.faultRate);
      if (k > 0) minUtil = Math.min(minUtil, s.metrics.cpuUtil);
    }
    expect(s.counters.faults).toBeGreaterThan(60);
    expect(peakFaultRate).toBeGreaterThan(0.5);
    expect(minUtil).toBeLessThan(0.5);
  });

  it('进程饥饿:优先级调度下低优先级进程在守护进程运行期间得不到 CPU', () => {
    const s = booted({ algo: 'prio' });
    s.spawnProcess('daemon');
    s.spawnProcess('daemon');
    run(s, 4000); // 守护进程工作集预热(此后不再阻塞)
    s.spawnProcess('starveLow');
    run(s, 8000);
    const low = s.procs.find((p) => p.role === 'starveLow');
    const daemons = s.procs.filter((p) => p.role === 'daemon');
    expect(low).toBeDefined();
    // 饥饿:守护进程持续运行期间,低优先级进程要么从未被调度,要么首次调度被大幅推迟
    expect(low!.start === -1 || low!.start - low!.arrival > 3000).toBe(true);
    expect(daemons.every((d) => d.cpuTime > 1000)).toBe(true);
  });
});

describe('确定性与挂起', () => {
  it('相同种子两次运行事件序列一致', () => {
    const runOnce = () => {
      const s = booted({ quantum: 300 });
      s.spawnProcess('compute');
      run(s, 7000);
      return s
        .drainEvents()
        .map((e) => `${e.kind}:${e.pid ?? ''}:${e.vpn ?? ''}:${e.pfn ?? ''}`)
        .slice(0, 500);
    };
    const a = runOnce();
    const b = runOnce();
    expect(a.length).toBeGreaterThan(50);
    expect(a).toEqual(b);
  });

  it('拆解超限挂起:时钟冻结、禁止上电', () => {
    const s = booted();
    s.spawnProcess('compute');
    run(s, 1000);
    const frozen = s.cycle;
    s.setSuspended(true);
    s.advance(10, 1);
    expect(s.cycle).toBe(frozen);
    expect(s.requestShutdown()).toBe(false);
    s.setSuspended(false);
    expect(s.requestShutdown()).toBe(true);
  });
});
