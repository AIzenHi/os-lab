// 右侧指标面板:系统指标 / CPU 状态 / 进程表 / 时间线 / Canvas 历史曲线
import { useEffect, useRef } from 'react';
import { useLab } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Canvas 折线图(零依赖,细线直角风格) */
function Sparkline({
  data,
  color,
  label,
  max = 1
}: {
  data: number[];
  color: string;
  label: string;
  max?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // 背景网格
    ctx.strokeStyle = '#1a1f27';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round((H * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    if (data.length < 2) return;
    const n = data.length;
    const step = W / Math.max(1, n - 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step;
      const y = H - (Math.min(v, max) / max) * (H - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, color, max]);
  return (
    <div style={{ padding: '2px 10px 6px' }}>
      <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '0.16em', marginBottom: 2 }}>
        {label}
      </div>
      <canvas ref={ref} width={228} height={44} style={{ display: 'block', border: '1px solid var(--line)' }} aria-label={label} role="img" />
    </div>
  );
}

const PHASES: StringKey[] = [
  'phase_idle',
  'phase_boot',
  'phase_load',
  'phase_ready',
  'phase_exec',
  'phase_mem',
  'phase_io',
  'phase_ctx',
  'phase_intr',
  'phase_halt'
];

const PHASE_KEY: Record<string, string> = {
  idle: 'phase_idle',
  boot: 'phase_boot',
  load: 'phase_load',
  ready: 'phase_ready',
  exec: 'phase_exec',
  mem: 'phase_mem',
  io: 'phase_io',
  ctx: 'phase_ctx',
  intr: 'phase_intr',
  halt: 'phase_halt'
};

export function MetricsPanel() {
  const t = useT();
  const snap = useLab((s) => s.snapshot);
  const selectPhase = useLab((s) => s.selectPhase);
  const selectedPhase = useLab((s) => s.selectedPhase);
  const selectedPart = useLab((s) => s.selectedPart);

  const m = snap?.metrics;
  const phase = snap?.phase ?? 'idle';
  const phaseKey = PHASE_KEY[phase] ?? 'phase_idle';

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        top: 56,
        bottom: 12,
        width: 252,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
        zIndex: 10
      }}
      role="group"
      aria-label={t('c_metrics_title')}
    >
      {/* 运行阶段 */}
      <div className="panel">
        <div className="panel-title" title={t('panel_hint_metrics')}>
          {t('sim_state')}<span className="kbd">2</span>
        </div>
        <div className="phase-strip" style={{ padding: 6 }}>
          {PHASES.map((k) => {
            const id = k.replace('phase_', '');
            const active = phase === id;
            const related = selectedPhase === id && !active;
            return (
              <button
                key={k}
                className={`phase-item ${active ? 'active' : ''} ${related ? 'related' : ''}`}
                onClick={() => selectPhase(related ? null : id)}
                aria-pressed={active || related}
                title={t(`${k}_d` as StringKey)}
              >
                <span className="dot" />
                {t(k)}
                {active && <span style={{ marginLeft: 'auto', color: 'var(--cold)' }}>●</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 9, color: 'var(--dim)', padding: '2px 10px 6px', letterSpacing: '0.1em' }}>
          {t(`${phaseKey}_d` as StringKey)}
        </div>
      </div>

      {/* 指标 */}
      <div className="panel">
        <div className="panel-title">{t('c_metrics_title')}</div>
        <div style={{ padding: '6px 0 4px' }}>
          <div className="metric-row">
            <span className="k">{t('m_cpu')}</span>
            <span className={`v ${phase === 'halt' ? 'warm' : 'cold'}`}>{pct(m?.cpuUtil ?? 0)}</span>
          </div>
          <div className="bar">
            <i className={phase === 'halt' ? 'warm' : ''} style={{ width: pct(m?.cpuUtil ?? 0) }} />
          </div>
          <div className="metric-row">
            <span className="k">{t('m_cache')}</span>
            <span className="v cold">{pct(m?.cacheHit ?? 0)}</span>
          </div>
          <div className="bar">
            <i style={{ width: pct(m?.cacheHit ?? 0) }} />
          </div>
          <div className="metric-row">
            <span className="k">{t('m_fault')}</span>
            <span className={`v ${(m?.faultRate ?? 0) > 0.3 ? 'alarm' : 'warm'}`}>
              {pct(m?.faultRate ?? 0)}
            </span>
          </div>
          <div className="bar">
            <i className={(m?.faultRate ?? 0) > 0.3 ? 'alarm' : 'warm'} style={{ width: pct(m?.faultRate ?? 0) }} />
          </div>
          <div className="metric-row">
            <span className="k">{t('m_mem')}</span>
            <span className="v">{pct(m?.memUsage ?? 0)}</span>
          </div>
          <div className="bar">
            <i className="brass" style={{ width: pct(m?.memUsage ?? 0) }} />
          </div>
          <div className="metric-row">
            <span className="k">{t('m_ctx')}</span>
            <span className="v">{m?.ctxSwitches ?? 0} {t('unit_switch')}</span>
          </div>
          <div className="metric-row">
            <span className="k">{t('m_tat')}</span>
            <span className="v">{Math.round(m?.avgTurnaround ?? 0)} {t('unit_cycle')}</span>
          </div>
          <div className="metric-row">
            <span className="k">{t('m_thr')}</span>
            <span className="v green">{((m?.throughput ?? 0) / 10000).toFixed(2)}</span>
          </div>
          <div className="metric-row">
            <span className="k">{t('m_instr')}</span>
            <span className="v">{m?.instructions ?? 0}</span>
          </div>
          <div className="metric-row">
            <span className="k">{t('m_cycle')}</span>
            <span className="v">{snap?.cycle ?? 0}</span>
          </div>
          <div className="metric-row">
            <span className="k">{t('temp_label')}</span>
            <span className="v">{(snap?.temp ?? 22).toFixed(1)}°C</span>
          </div>
        </div>
      </div>

      {/* 历史曲线 */}
      <div className="panel">
        <div className="panel-title">{t('c_charts')}</div>
        <Sparkline data={snap?.series.cpu ?? []} color="#4fa3d9" label={t('chart_cpu')} />
        <Sparkline data={snap?.series.cache ?? []} color="#5aa88f" label={t('chart_cache')} />
        <Sparkline data={snap?.series.fault ?? []} color="#e08a3c" label={t('chart_fault')} />
      </div>

      {/* 进程表 */}
      <div className="panel">
        <div className="panel-title">{t('c_proc')}</div>
        <div style={{ padding: '4px 10px 8px', fontSize: 10 }}>
          {(snap?.procs ?? []).length === 0 && (
            <div style={{ color: '#4a4e55' }}>{t('c_none')}</div>
          )}
          {(snap?.procs ?? []).map((p) => (
            <div
              key={p.pid}
              style={{
                display: 'grid',
                gridTemplateColumns: '34px 1fr 52px 44px',
                gap: 6,
                padding: '2px 0',
                borderBottom: '1px solid #14171d',
                color:
                  p.state === 'running'
                    ? 'var(--warm)'
                    : p.state === 'blocked'
                      ? 'var(--cold)'
                      : p.state === 'ready'
                        ? 'var(--bone)'
                        : '#4a4e55'
              }}
            >
              <span>P{p.pid}</span>
              <span>{t(`role_${p.role}` as StringKey)}</span>
              <span>
                {t(
                  (p.state === 'blocked'
                    ? `block_${p.blockOn}`
                    : `proc_${p.state}`) as StringKey
                )}
              </span>
              <span style={{ textAlign: 'right' }}>p{p.priority}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 调度决策时间线 */}
      <div className="panel">
        <div className="panel-title">{t('c_timeline')}</div>
        <div style={{ padding: '4px 10px 8px', fontSize: 10, maxHeight: 168, overflowY: 'auto' }}>
          {(snap?.timeline ?? []).length === 0 && (
            <div style={{ color: '#4a4e55' }}>--</div>
          )}
          {(snap?.timeline ?? [])
            .slice()
            .reverse()
            .map((e, i) => (
              <div
                key={`${e.t}:${e.key}:${i}`}
                style={{ display: 'flex', gap: 6, padding: '1px 0', color: '#9aa0a8' }}
              >
                <span style={{ color: '#565c66', width: 44, textAlign: 'right' }}>{e.t}</span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    flex: 'none',
                    marginTop: 3,
                    background:
                      e.kind === 'preempt' || e.kind === 'sched'
                        ? 'var(--warm)'
                        : e.kind === 'fault'
                          ? 'var(--alarm)'
                          : e.kind === 'sys' || e.kind === 'int'
                            ? 'var(--brass)'
                            : e.kind === 'shutdown' || e.kind === 'suspend'
                              ? '#565c66'
                              : 'var(--cold)'
                  }}
                />
                <span>
                  {t(e.key as StringKey, { pid: e.pid ?? '', a: e.a ?? '', b: e.b ?? '', num: e.num ?? '' })}
                </span>
              </div>
            ))}
        </div>
      </div>
      {void selectedPart}
    </div>
  );
}
