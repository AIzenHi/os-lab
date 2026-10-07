// CPU 状态面板:流水线 / 寄存器 / TLB / 缓存 / 页框 / 信号量 / 文件系统
import { useLab } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';

const STAGE_LABEL: Record<string, StringKey> = {
  if: 'if_',
  id: 'id_',
  ex: 'ex_',
  mem: 'mem_',
  wb: 'wb_'
};

export function CpuPanel() {
  const t = useT();
  const snap = useLab((s) => s.snapshot);
  if (!snap) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 296,
        top: 64,
        width: 258,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9
      }}
      role="group"
      aria-label={t('c_cpu_state')}
    >
      {/* CPU 状态 */}
      <div className="panel">
        <div className="panel-title" title={t('panel_hint_cpu')}>
          {t('c_cpu_state')}<span className="kbd">3</span>
        </div>
        <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className={`tag ${snap.cpuMode === 'kernel' ? '' : ''}`} style={{
              color: snap.cpuMode === 'kernel' ? 'var(--warm)' : 'var(--cold)',
              borderColor: snap.cpuMode === 'kernel' ? 'var(--warm)' : 'var(--cold)'
            }}>
              {snap.cpuMode === 'kernel' ? t('c_kernel') : t('c_user')}
            </span>
            <span className="tag">PC {snap.pc}</span>
            <span className="tag">
              {t('c_current')} {snap.currentPid === null ? t('c_none') : `P${snap.currentPid}`}
            </span>
          </div>
          {/* 流水线 */}
          <div style={{ display: 'flex', gap: 3 }}>
            {snap.pipeline.map((st) => (
              <div
                key={st.key}
                title={st.text}
                style={{
                  flex: 1,
                  border: `1px solid ${st.active ? 'var(--cold)' : 'var(--line)'}`,
                  background: st.active ? '#0d151c' : 'transparent',
                  padding: '3px 2px',
                  textAlign: 'center',
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  color: st.active ? 'var(--cold)' : 'var(--dim)'
                }}
              >
                {t(STAGE_LABEL[st.key])}
                <div style={{ color: 'var(--bone)', fontSize: 9, marginTop: 2 }}>
                  {st.active ? (st.text.split(' ')[0] || '·') : '·'}
                </div>
              </div>
            ))}
          </div>
          {/* 寄存器堆 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {snap.regs.map((v, i) => (
              <span
                key={i}
                className="tag"
                style={{ color: v !== 0 ? 'var(--bone)' : '#4a4e55' }}
                title={`R${i}`}
              >
                R{i}={v & 0xff}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* TLB */}
      <div className="panel">
        <div className="panel-title">{t('c_tlb')}</div>
        <div style={{ padding: '4px 10px 8px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {snap.tlb.map((e, i) =>
            e.valid ? (
              <span key={i} className="tag" style={{ color: 'var(--brass)' }}>
                P{e.pid}/v{e.vpn}→f{e.pfn}
              </span>
            ) : (
              <span key={i} className="tag" style={{ color: '#3a414c' }}>
                ·
              </span>
            )
          )}
        </div>
      </div>

      {/* 缓存层次 */}
      <div className="panel">
        <div className="panel-title">{t('m_cache')}</div>
        {snap.caches.map((c) => (
          <div key={c.level} className="metric-row">
            <span className="k">
              {c.level.toUpperCase()} ×{c.size}
            </span>
            <span className="v cold" title={`hits ${c.hits} / misses ${c.misses} / wb ${c.writebacks}`}>
              {c.hits + c.misses > 0 ? `${(c.hitRate * 100).toFixed(0)}%` : '--'} ({c.occupancy}/{c.size})
            </span>
          </div>
        ))}
      </div>

      {/* 信号量与文件系统 */}
      <div className="panel">
        <div className="panel-title">{t('part_sem')}</div>
        {snap.sems.map((s) => (
          <div key={s.id} className="metric-row">
            <span className="k">
              S{s.id} {s.value === 1 ? t('sem_free') : `${t('sem_owner')} P${s.owner}`}
            </span>
            <span className="v">
              {s.waiters.length > 0 ? `P${s.waiters.join(',P')}` : '--'}
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-title">{t('c_disk_files')}</div>
        <div style={{ padding: '4px 10px 8px', fontSize: 10, color: 'var(--dim)', lineHeight: 1.7 }}>
          {snap.disk.files.map((f) => (
            <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: f.kind === 'checkpoint' ? 'var(--green)' : 'var(--bone)' }}>{f.name}</span>
              <span>{f.blocks}b</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: 'var(--dim)' }}>
            <span>
              R{snap.disk.reads} / W{snap.disk.writes}
            </span>
            <span>
              {snap.disk.used}/{snap.disk.total}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
