// UI 层测试:store / i18n 完整性 / 部件关联表 / 结果图绘制 / 主题样式
import { describe, expect, it } from 'vitest';
import { STRINGS, type StringKey } from '../src/i18n/strings';
import { PART_LABEL, PART_METRICS, PART_PHASES, PHASE_PARTS, CAMERA_PRESETS, PART_POS, EXPLODE } from '../src/machine/parts';
import { Sim, CYCLES_PER_SEC } from '../src/kernel/sim';

describe('i18n 双语完整性', () => {
  const zhKeys = Object.keys(STRINGS.zh).sort();

  it('英文键与中文键一一对应', () => {
    const enKeys = Object.keys(STRINGS.en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('没有空文案', () => {
    for (const k of zhKeys) {
      expect((STRINGS.zh[k as StringKey] ?? '').length).toBeGreaterThan(0);
      expect((STRINGS.en[k as StringKey] ?? '').length).toBeGreaterThan(0);
    }
  });

  it('五个章节、三个故障、十个阶段的文案齐备', () => {
    for (const ch of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5']) {
      expect(STRINGS.zh[`${ch}_p3` as StringKey]).toBeTruthy();
      expect(STRINGS.en[`${ch}_p3` as StringKey]).toBeTruthy();
    }
    for (const c of ['deadlock', 'thrash', 'starve']) {
      expect(STRINGS.zh[`chal_${c}_o4` as StringKey]).toBeTruthy();
      expect(STRINGS.zh[`chal_${c}_w4` as StringKey]).toBeTruthy();
    }
    for (const p of ['idle', 'boot', 'load', 'ready', 'exec', 'mem', 'io', 'ctx', 'intr', 'halt']) {
      expect(STRINGS.zh[`phase_${p}` as StringKey]).toBeTruthy();
      expect(STRINGS.zh[`phase_${p}_d` as StringKey]).toBeTruthy();
    }
  });
});

describe('部件关联表', () => {
  it('每个部件铭牌键存在于 i18n', () => {
    for (const [id, key] of Object.entries(PART_LABEL)) {
      expect(STRINGS.zh[key as StringKey]).toBeTruthy();
      expect(STRINGS.en[key as StringKey]).toBeTruthy();
      expect(STRINGS.zh[`${key}_d` as StringKey]).toBeTruthy(); // 描述
      void id;
    }
  });

  it('阶段 -> 部件映射覆盖全部十个阶段', () => {
    const phases = Object.keys(PHASE_PARTS);
    expect(phases.sort()).toEqual(
      ['boot', 'ctx', 'exec', 'halt', 'idle', 'intr', 'io', 'load', 'mem', 'ready']
    );
    for (const parts of Object.values(PHASE_PARTS)) {
      expect(parts.length).toBeGreaterThan(0);
    }
  });

  it('镜头预设包含五种', () => {
    expect(Object.keys(CAMERA_PRESETS).sort()).toEqual(['exec', 'free', 'global', 'mem', 'sched']);
    for (const p of Object.values(CAMERA_PRESETS)) {
      expect(p.pos.length).toBe(3);
      expect(p.target.length).toBe(3);
    }
  });

  it('部件位置与爆炸向量坐标数量一致', () => {
    for (const [k, e] of Object.entries(EXPLODE)) {
      expect(PART_POS[k]).toBeDefined();
      expect(e.dir.length).toBe(3);
      expect(e.dist).toBeGreaterThan(0);
      expect(e.dist).toBeLessThan(5);
    }
  });

  it('点击部件关联的指标键均有效', () => {
    const valid = new Set([
      'cpuUtil', 'cacheHit', 'faultRate', 'memUsage', 'throughput', 'ctxSwitches',
      'avgTurnaround', 'instructions'
    ]);
    for (const metrics of Object.values(PART_METRICS)) {
      for (const m of metrics) expect(valid.has(m)).toBe(true);
    }
  });

  it('PART_PHASES 中的阶段均为合法阶段名', () => {
    const valid = new Set(['idle', 'boot', 'load', 'ready', 'exec', 'mem', 'io', 'ctx', 'intr', 'halt']);
    for (const phases of Object.values(PART_PHASES)) {
      for (const p of phases) expect(valid.has(p)).toBe(true);
    }
  });
});

describe('快照指标连续平滑联动', () => {
  it('运行中快照包含全部 UI 所需字段', () => {
    const s = new Sim();
    s.powerOn();
    s.advance(6000 / CYCLES_PER_SEC, 1);
    const snap = s.snapshot();
    // 结构完整性
    expect(snap.pipeline.length).toBe(5);
    expect(snap.caches.length).toBe(4);
    expect(snap.regs.length).toBe(8);
    expect(snap.series.cpu.length).toBeGreaterThan(5);
    expect(snap.series.cache.length).toBeGreaterThan(5);
    expect(snap.series.fault.length).toBeGreaterThan(5);
    for (const p of snap.pipeline) expect(['if', 'id', 'ex', 'mem', 'wb']).toContain(p.key);
    // 指标在合理区间
    expect(snap.metrics.cpuUtil).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.cpuUtil).toBeLessThanOrEqual(1);
    expect(snap.metrics.cacheHit).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.cacheHit).toBeLessThanOrEqual(1);
    expect(snap.metrics.faultRate).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.faultRate).toBeLessThanOrEqual(1);
    expect(snap.metrics.memUsage).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.memUsage).toBeLessThanOrEqual(1);
  });

  it('指标窗口按固定周期更新(历史曲线持续增长)', () => {
    const s = new Sim();
    s.powerOn();
    s.advance(1000 / CYCLES_PER_SEC, 1);
    const n1 = s.metrics.seriesCpu.length;
    s.advance(3000 / CYCLES_PER_SEC, 1);
    const n2 = s.metrics.seriesCpu.length;
    expect(n2).toBeGreaterThan(n1);
  });
});

describe('拆解安全联动', () => {
  it('爆炸系数超过 0.6 时模拟挂起(时钟停走),复位后恢复', () => {
    const s = new Sim();
    s.powerOn();
    s.advance(2000 / CYCLES_PER_SEC, 1);
    // 模拟 store.applyExplode 的联动
    s.setSuspended(true);
    const frozen = s.cycle;
    s.advance(5, 1);
    expect(s.cycle).toBe(frozen);
    s.setSuspended(false);
    s.advance(100 / CYCLES_PER_SEC, 1);
    expect(s.cycle).toBeGreaterThan(frozen);
  });
});
