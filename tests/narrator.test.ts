// 实况解说与看板开关测试
import { describe, expect, it, beforeEach } from 'vitest';
import { buildNarrative } from '../src/ui/Narrator';
import { Sim, CYCLES_PER_SEC } from '../src/kernel/sim';
import { STRINGS, type StringKey } from '../src/i18n/strings';

const P = (n: number) => n / CYCLES_PER_SEC;
const run = (s: Sim, n: number) => s.advance(P(n), 1);

function bootedSim(): Sim {
  const s = new Sim();
  s.powerOn();
  run(s, 1600);
  return s;
}

describe('实况解说 buildNarrative', () => {
  it('关机时解说为"机器在睡觉"', () => {
    const s = new Sim();
    const n = buildNarrative(s.snapshot());
    expect(n.head).toBe('narr_idle_h');
    expect(n.body).toBe('narr_idle_b');
    expect(n.facts).toHaveLength(0);
  });

  it('引导各阶段映射到对应大白话(检查大脑/数工作台/读取开机程序/请出大管家)', () => {
    const s = new Sim();
    s.powerOn();
    run(s, 30); // post-cpu
    expect(buildNarrative(s.snapshot()).head).toBe('narr_boot_cpu_h');
    run(s, 70); // post-mem
    expect(buildNarrative(s.snapshot()).head).toBe('narr_boot_mem_h');
    run(s, 200); // bootloader DMA
    expect(['narr_boot_loader_h', 'narr_boot_kernel_h', 'narr_boot_cpu_h']).toContain(
      buildNarrative(s.snapshot()).head
    );
  });

  it('运行阶段产生执行解说并带进程号参数与事实行', () => {
    const s = bootedSim();
    s.spawnProcess('compute');
    run(s, 6000);
    const n = buildNarrative(s.snapshot());
    // 运行中:处于八大运行阶段之一
    expect(n.head).not.toBe('narr_idle_h');
    expect(n.facts.length).toBeGreaterThan(0);
    // 指令事实行存在且数值与快照一致
    const instr = n.facts.find((f) => f.key === 'narr_fact_instr');
    expect(instr).toBeDefined();
    expect(instr!.params?.n).toBe(s.counters.instructions);
    // 命中率事实行数值为百分比字符串
    const cache = n.facts.find((f) => f.key === 'narr_fact_cache');
    if (cache) expect(String(cache.params?.pct)).toMatch(/^\d+%$/);
  });

  it('exec 阶段正文带当前进程号', () => {
    const s = bootedSim();
    s.spawnProcess('compute');
    // 推进到 exec 阶段
    for (let i = 0; i < 4000; i++) {
      run(s, 1);
      const n = buildNarrative(s.snapshot());
      if (n.head === 'narr_exec_h') {
        expect(n.params?.pid).toBe(s.currentPid);
        return;
      }
    }
    throw new Error('未进入 exec 阶段');
  });

  it('最近事件映射为"刚刚"人话行(timeline 优先取最新可翻译条目)', () => {
    const s = bootedSim();
    s.spawnProcess('compute');
    run(s, 6000);
    const n = buildNarrative(s.snapshot());
    // 运行一段时间后,时间线必有可翻译条目(装载/缺页/叫号/唤醒等)
    expect(n.recent).not.toBeNull();
    expect(n.recent!.key.startsWith('narr_recent_')).toBe(true);
    // 翻译后的正文含进程号 P 前缀或描述文字(非空)
    const text = STRINGS.zh[n.recent!.key as StringKey];
    expect(text.length).toBeGreaterThan(2);
  });

  it('停机各阶段映射到对应大白话', () => {
    const s = bootedSim();
    s.spawnProcess('compute');
    run(s, 2000);
    s.requestShutdown();
    const seen: string[] = [];
    let guard = 0;
    while (s.power && guard++ < 40000) {
      run(s, 1);
      const st = s.shutdown?.stage;
      if (st && !seen.includes(st)) seen.push(st);
    }
    expect(seen).toContain('cooldown');
    expect(seen).toContain('clock-stop');
    // cooldown 阶段的解说
    const s2 = bootedSim();
    s2.requestShutdown();
    let head = '';
    let g = 0;
    while (s2.power && g++ < 40000) {
      run(s2, 1);
      const n = buildNarrative(s2.snapshot());
      if (n.head.startsWith('narr_stop_cool')) {
        head = n.head;
        break;
      }
    }
    expect(head).toBe('narr_stop_cool_h');
  });
});

describe('看板开关(store)', () => {
  // store 在 node 环境下可用(localStorage 被保护)
  beforeEach(async () => {
    const { useLab } = await import('../src/state/store');
    useLab.setState({
      panels: { console: true, metrics: true, cpu: true, narrator: true }
    });
  });

  it('togglePanel 切换单个看板', async () => {
    const { useLab } = await import('../src/state/store');
    expect(useLab.getState().panels.console).toBe(true);
    useLab.getState().togglePanel('console');
    expect(useLab.getState().panels.console).toBe(false);
    expect(useLab.getState().panels.metrics).toBe(true); // 其它不受影响
    useLab.getState().togglePanel('console');
    expect(useLab.getState().panels.console).toBe(true);
  });

  it('toggleFocusMode:任一开启 -> 全关;全关 -> 全开', async () => {
    const { useLab } = await import('../src/state/store');
    useLab.getState().toggleFocusMode();
    expect(useLab.getState().panels).toEqual({
      console: false,
      metrics: false,
      cpu: false,
      narrator: false
    });
    useLab.getState().toggleFocusMode();
    expect(useLab.getState().panels).toEqual({
      console: true,
      metrics: true,
      cpu: true,
      narrator: true
    });
  });

  it('专注模式后单个看板可单独恢复', async () => {
    const { useLab } = await import('../src/state/store');
    useLab.getState().toggleFocusMode(); // 全关
    useLab.getState().togglePanel('narrator'); // 只开解说
    expect(useLab.getState().panels.narrator).toBe(true);
    expect(useLab.getState().panels.console).toBe(false);
  });
});

describe('新增文案完整性', () => {
  it('新手引导五步文案齐备(zh/en)', () => {
    for (let i = 1; i <= 5; i++) {
      expect(STRINGS.zh[`g${i}_t` as StringKey]).toBeTruthy();
      expect(STRINGS.zh[`g${i}_b` as StringKey]).toBeTruthy();
      expect(STRINGS.en[`g${i}_t` as StringKey]).toBeTruthy();
      expect(STRINGS.en[`g${i}_b` as StringKey]).toBeTruthy();
      expect((STRINGS.zh[`g${i}_b` as StringKey] ?? '').length).toBeGreaterThan(40);
    }
  });

  it('十个运行阶段 + 全部引导/停机子阶段解说齐备(zh/en)', () => {
    const heads = [
      'narr_idle_h',
      'narr_load_h',
      'narr_ready_h',
      'narr_exec_h',
      'narr_mem_h',
      'narr_io_h',
      'narr_ctx_h',
      'narr_intr_h'
    ];
    const boots = ['cpu', 'mem', 'dev', 'loader', 'kernel', 'pt', 'ivt', 'dev2'].map(
      (k) => `narr_boot_${k}_h`
    );
    const stops = ['wait', 'reclaim', 'checkpoint', 'cool', 'clock', 'bus'].map(
      (k) => `narr_stop_${k}_h`
    );
    for (const key of [...heads, ...boots, ...stops]) {
      expect(STRINGS.zh[key as StringKey]).toBeTruthy();
      expect(STRINGS.en[key as StringKey]).toBeTruthy();
    }
    // 每个解说标题都有对应正文
    for (const h of [...heads, ...boots, ...stops]) {
      const b = h.replace(/_h$/, '_b');
      expect(STRINGS.zh[b as StringKey]).toBeTruthy();
      expect(STRINGS.en[b as StringKey]).toBeTruthy();
    }
  });

  it('解说不使用生硬术语:正文避免 TLB/PCB/MMU 等缩写', () => {
    const jargon = ['TLB', 'PCB', 'MMU', 'DMA', 'inode', 'Inode'];
    const keys = Object.keys(STRINGS.zh).filter(
      (k) => k.startsWith('narr_') && k.endsWith('_b')
    ) as StringKey[];
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const k of keys) {
      const text = STRINGS.zh[k];
      for (const j of jargon) {
        expect(`${k}: ${text}`).not.toContain(j);
      }
    }
  });
});
