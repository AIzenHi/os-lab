// 实况解说看板:用大白话实时讲解机器在干什么
// buildNarrative 为纯函数(返回 i18n 键 + 参数),便于测试
import { useLab } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';
import type { SimSnapshot } from '../kernel/sim';

export interface NarrFact {
  key: StringKey;
  params?: Record<string, string | number>;
}

export interface Narrative {
  head: StringKey;
  body: StringKey;
  params?: Record<string, string | number>;
  facts: NarrFact[];
  recent: NarrFact | null;
}

/** 引导阶段 -> 解说键 */
const BOOT_NARR: Record<string, [StringKey, StringKey]> = {
  'post-cpu': ['narr_boot_cpu_h', 'narr_boot_cpu_b'],
  'post-mem': ['narr_boot_mem_h', 'narr_boot_mem_b'],
  'post-dev': ['narr_boot_dev_h', 'narr_boot_dev_b'],
  bootloader: ['narr_boot_loader_h', 'narr_boot_loader_b'],
  'kernel-1': ['narr_boot_kernel_h', 'narr_boot_kernel_b'],
  'kernel-2': ['narr_boot_kernel_h', 'narr_boot_kernel_b'],
  'kernel-3': ['narr_boot_kernel_h', 'narr_boot_kernel_b'],
  'kinit-pt': ['narr_boot_pt_h', 'narr_boot_pt_b'],
  'kinit-ivt': ['narr_boot_ivt_h', 'narr_boot_ivt_b'],
  'kinit-dev': ['narr_boot_dev2_h', 'narr_boot_dev2_b']
};

/** 停机阶段 -> 解说键 */
const STOP_NARR: Record<string, [StringKey, StringKey]> = {
  finish: ['narr_stop_wait_h', 'narr_stop_wait_b'],
  reclaim: ['narr_stop_reclaim_h', 'narr_stop_reclaim_b'],
  checkpoint: ['narr_stop_checkpoint_h', 'narr_stop_checkpoint_b'],
  cooldown: ['narr_stop_cool_h', 'narr_stop_cool_b'],
  'clock-stop': ['narr_stop_clock_h', 'narr_stop_clock_b'],
  'bus-off': ['narr_stop_bus_h', 'narr_stop_bus_b']
};

/** 时间线事件 -> 人话 */
const RECENT_NARR: Record<string, StringKey> = {
  tl_pick: 'narr_recent_pick',
  tl_quantum: 'narr_recent_quantum',
  tl_wake: 'narr_recent_wake',
  tl_io_block: 'narr_recent_block',
  tl_fault: 'narr_recent_fault',
  tl_pagein: 'narr_recent_pagein',
  tl_evict: 'narr_recent_evict',
  tl_exit: 'narr_recent_exit',
  tl_sys: 'narr_recent_sys',
  tl_load: 'narr_recent_load',
  tl_checkpoint: 'narr_recent_checkpoint',
  tl_deadlock: 'narr_recent_deadlock',
  tl_sem_block: 'narr_recent_sem'
};

function recentOf(snap: SimSnapshot): NarrFact | null {
  const entries = snap.timeline ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const key = RECENT_NARR[e.key];
    if (!key) continue;
    return { key, params: { pid: e.pid ?? '' } };
  }
  return null;
}

export function buildNarrative(snap: SimSnapshot | null): Narrative {
  if (!snap || !snap.power) {
    return { head: 'narr_idle_h', body: 'narr_idle_b', facts: [], recent: null };
  }
  // 停机阶段优先(电源未断时)
  if (snap.shutdownStage) {
    const pair = STOP_NARR[snap.shutdownStage] ?? STOP_NARR.finish;
    return { head: pair[0], body: pair[1], facts: [], recent: recentOf(snap) };
  }
  // 引导阶段
  if (snap.bootStage !== 'done' && snap.bootStage !== 'off') {
    const pair = BOOT_NARR[snap.bootStage] ?? BOOT_NARR['post-cpu'];
    return { head: pair[0], body: pair[1], facts: [], recent: recentOf(snap) };
  }
  const pid = snap.currentPid ?? 0;
  const facts: NarrFact[] = [];
  if (snap.metrics.instructions > 0) {
    facts.push({ key: 'narr_fact_instr', params: { n: snap.metrics.instructions } });
  }
  if (snap.metrics.cacheHit > 0) {
    facts.push({ key: 'narr_fact_cache', params: { pct: `${Math.round(snap.metrics.cacheHit * 100)}%` } });
  }
  if (snap.readyQueue.length > 0) {
    facts.push({ key: 'narr_fact_queue', params: { n: snap.readyQueue.length } });
  }
  if (snap.metrics.ctxSwitches > 0) {
    facts.push({ key: 'narr_fact_switch', params: { n: snap.metrics.ctxSwitches } });
  }
  switch (snap.phase) {
    case 'load':
      return { head: 'narr_load_h', body: 'narr_load_b', params: { pid }, facts, recent: recentOf(snap) };
    case 'ready':
      return { head: 'narr_ready_h', body: 'narr_ready_b', facts, recent: recentOf(snap) };
    case 'exec':
      return { head: 'narr_exec_h', body: 'narr_exec_b', params: { pid }, facts, recent: recentOf(snap) };
    case 'mem':
      return { head: 'narr_mem_h', body: 'narr_mem_b', facts, recent: recentOf(snap) };
    case 'io':
      return { head: 'narr_io_h', body: 'narr_io_b', params: { pid }, facts, recent: recentOf(snap) };
    case 'ctx':
      return { head: 'narr_ctx_h', body: 'narr_ctx_b', facts, recent: recentOf(snap) };
    case 'intr':
      return { head: 'narr_intr_h', body: 'narr_intr_b', facts, recent: recentOf(snap) };
    case 'halt':
      return { head: 'narr_stop_wait_h', body: 'narr_stop_wait_b', facts, recent: recentOf(snap) };
    case 'boot':
      return { head: 'narr_boot_kernel_h', body: 'narr_boot_kernel_b', facts, recent: recentOf(snap) };
    default:
      return { head: 'narr_ready_h', body: 'narr_ready_b', facts, recent: recentOf(snap) };
  }
}

export function Narrator() {
  const t = useT();
  const snap = useLab((s) => s.snapshot);
  const n = buildNarrative(snap);
  return (
    <div
      className="panel"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 58,
        width: 470,
        maxWidth: 'calc(100vw - 40px)',
        zIndex: 8
      }}
      role="status"
      aria-live="polite"
      aria-label={t('narr_title')}
    >
      <div className="panel-title" title={t('panel_hint_narr')}>
        {t('narr_title')} <span className="kbd">4</span>
      </div>
      <div style={{ padding: '8px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '0.2em' }}>
            {t('narr_now')}
          </span>
          <span style={{ fontSize: 14, color: 'var(--bone)', letterSpacing: '0.08em' }}>
            {t(n.head)}
          </span>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.9, color: '#b8bdc6', marginTop: 4 }}>
          {t(n.body, n.params)}
        </div>
        {n.recent && (
          <div style={{ fontSize: 10, color: 'var(--brass)', marginTop: 6 }}>
            {t('narr_just')}:{t(n.recent.key, n.recent.params)}
          </div>
        )}
        {n.facts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {n.facts.map((f) => (
              <span key={f.key} className="tag" style={{ color: 'var(--cold)' }}>
                {t(f.key, f.params)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
