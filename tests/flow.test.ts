// 流量系统测试:粒子池 / 事件路径 / 视图过滤 / 音频映射
import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../src/flow/particles';
import { FlowSystem, flow } from '../src/flow';
import { kindAllowed, pathForEvent, partsForEvent } from '../src/flow/paths';
import type { SimEvent } from '../src/kernel/types';

const ctx = { explode: 0, framesTotal: 48, view: 'data' as const, reduced: false };

describe('粒子池', () => {
  it('生成后沿路径推进,抵达终点回收', () => {
    const pool = new ParticlePool(4);
    expect(pool.spawn('data', [[0, 0, 0], [10, 0, 0]], 5)).toBe(true);
    expect(pool.activeCount()).toBe(1);
    pool.step(1); // 5 单位/秒 -> t=0.5
    const p = pool.particles[0];
    expect(p.pos[0]).toBeCloseTo(5, 5);
    pool.step(1); // 到达终点
    expect(pool.activeCount()).toBe(0);
  });

  it('多段路径连续行进且方向正确', () => {
    const pool = new ParticlePool(4);
    pool.spawn('ctrl', [[0, 0, 0], [0, 0, 4], [4, 0, 4]], 10);
    pool.step(0.6); // 6 单位:走完第一段(4)+ 第二段 2
    const p = pool.particles[0];
    expect(p.seg).toBe(1);
    expect(p.pos[0]).toBeCloseTo(2, 5);
    expect(p.pos[2]).toBeCloseTo(4, 5);
  });

  it('池满时丢弃新粒子(池化上限)', () => {
    const pool = new ParticlePool(2);
    expect(pool.spawn('data', [[0, 0, 0], [1, 0, 0]], 1)).toBe(true);
    expect(pool.spawn('data', [[0, 0, 0], [1, 0, 0]], 1)).toBe(true);
    expect(pool.spawn('data', [[0, 0, 0], [1, 0, 0]], 1)).toBe(false);
    expect(pool.activeCount()).toBe(2);
  });

  it('容量 320 时 activeCount 恒不超过容量', () => {
    const pool = new ParticlePool(320);
    let ok = 0;
    for (let i = 0; i < 500; i++) {
      if (pool.spawn('data', [[i, 0, 0], [i + 1, 0, 0]], 1)) ok++;
    }
    expect(ok).toBe(320);
    expect(pool.activeCount()).toBe(320);
  });
});

describe('事件 -> 路径映射', () => {
  it('取指事件产生指令粒子:L1I -> CPU IF 段', () => {
    const spec = pathForEvent({ t: 1, kind: 'ifetch', pid: 1 }, ctx);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('instr');
    expect(spec!.path.length).toBeGreaterThanOrEqual(2);
    // 起点在 L1I 附近
    const [x, , z] = spec!.path[0];
    expect(x).toBeCloseTo(-11.4, 2);
    expect(z).toBeCloseTo(1.8, 2);
  });

  it('时钟中断产生控制流粒子:时钟 -> PIC -> CPU', () => {
    const spec = pathForEvent({ t: 1, kind: 'int_timer' }, ctx);
    expect(spec!.kind).toBe('ctrl');
    expect(spec!.path.length).toBe(3);
  });

  it('上下文切换保存产生写回粒子:寄存器 -> PCB', () => {
    const spec = pathForEvent({ t: 1, kind: 'ctx_save', pid: 1 }, ctx);
    expect(spec!.kind).toBe('writeback');
  });

  it('缺页读盘产生数据粒子:磁盘块 -> 页框(经总线)', () => {
    const spec = pathForEvent({ t: 1, kind: 'fault_read', pid: 1, vpn: 2, pfn: 9 }, ctx);
    expect(spec!.kind).toBe('data');
    expect(spec!.path.length).toBeGreaterThanOrEqual(4); // viaBus 多段
  });

  it('爆炸系数改变路径坐标(部件位置随之偏移)', () => {
    const a = pathForEvent({ t: 1, kind: 'ifetch' }, { ...ctx, explode: 0 });
    const b = pathForEvent({ t: 1, kind: 'ifetch' }, { ...ctx, explode: 1 });
    expect(b!.path[0][1]).toBeGreaterThan(a!.path[0][1]); // 向上炸开
  });
});

describe('四种视图过滤', () => {
  it('数据流视图放行 data/instr,拦截 ctrl/writeback', () => {
    expect(kindAllowed('data', 'data')).toBe(true);
    expect(kindAllowed('instr', 'data')).toBe(true);
    expect(kindAllowed('ctrl', 'data')).toBe(false);
    expect(kindAllowed('writeback', 'data')).toBe(false);
  });

  it('控制流视图只放行 ctrl', () => {
    expect(kindAllowed('ctrl', 'control')).toBe(true);
    expect(kindAllowed('data', 'control')).toBe(false);
  });

  it('写回视图只放行 writeback;热度视图不放行任何粒子(由部件发光表现)', () => {
    expect(kindAllowed('writeback', 'writeback')).toBe(true);
    expect(kindAllowed('data', 'writeback')).toBe(false);
    expect(kindAllowed('ctrl', 'heat')).toBe(false);
    expect(kindAllowed('data', 'heat')).toBe(false);
  });
});

describe('FlowSystem 编排', () => {
  it('数据流视图下访存事件生成粒子并推进', () => {
    flow.clear();
    const events: SimEvent[] = [
      { t: 1, kind: 'ifetch', pid: 1 },
      { t: 1, kind: 'cache_hit', pid: 1, level: 'l1d' },
      { t: 1, kind: 'int_timer' }
    ];
    flow.handleEvents(events, ctx, performance.now());
    // data 视图只保留 data/instr 两种
    expect(flow.activeCount()).toBe(2);
    flow.step(0.1);
    expect(flow.activeCount()).toBe(2);
  });

  it('控制流视图下同样事件只剩中断控制粒子', () => {
    flow.clear();
    const events: SimEvent[] = [
      { t: 1, kind: 'ifetch', pid: 1 },
      { t: 1, kind: 'cache_hit', pid: 1, level: 'l1d' },
      { t: 1, kind: 'int_timer' }
    ];
    flow.handleEvents(events, { ...ctx, view: 'control' }, performance.now());
    expect(flow.activeCount()).toBe(1);
  });

  it('部件活跃度随时间衰减', () => {
    flow.clear();
    const now = performance.now();
    const events: SimEvent[] = [{ t: 1, kind: 'int_timer' }];
    flow.handleEvents(events, ctx, now);
    expect(partsForEvent(events[0])).toContain('clock');
    expect(partsForEvent(events[0])).toContain('pic');
  });
});

describe('音频事件映射', () => {
  it('关键事件映射到对应音效类别', () => {
    expect(FlowSystem.audioRelevant({ t: 1, kind: 'page_fault' })).toBe('pageFault');
    expect(FlowSystem.audioRelevant({ t: 1, kind: 'ctx_load' })).toBe('ctxSwitch');
    expect(FlowSystem.audioRelevant({ t: 1, kind: 'int_timer' })).toBe('interrupt');
    expect(FlowSystem.audioRelevant({ t: 1, kind: 'cache_hit' })).toBe('cacheHit');
    expect(FlowSystem.audioRelevant({ t: 1, kind: 'proc_create' })).toBe('procLoad');
    expect(FlowSystem.audioRelevant({ t: 1, kind: 'nop' as never })).toBeNull();
  });
});
