// 左侧操作台:电源 / 进程装载 / 调度参数 / 视图 / 镜头 / 拆解与剖切
import { useLab } from '../state/store';
import { useT } from '../i18n';
import { sim } from '../kernel/sim';
import type { SchedAlgo } from '../kernel/types';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-title">{title}</div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '86px 1fr', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.12em' }}>{label}</span>
      {children}
    </div>
  );
}

const ALGOS: SchedAlgo[] = ['fcfs', 'sjf', 'rr', 'prio'];
const VIEWS = ['data', 'control', 'heat', 'writeback'] as const;
const CAMS = ['global', 'exec', 'mem', 'sched', 'free'] as const;

export function Console() {
  const t = useT();
  const lab = useLab();
  const snap = lab.snapshot;
  const power = snap?.power ?? false;
  const shutting = snap?.shutdownStage != null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        top: 56,
        bottom: 12,
        width: 268,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
        zIndex: 10
      }}
      role="group"
      aria-label={t('c_power')}
    >
      <div
        style={{
          fontSize: 9,
          color: '#565c66',
          letterSpacing: '0.18em',
          border: '1px solid var(--line)',
          padding: '3px 8px',
          background: 'var(--panel)',
          display: 'flex',
          alignItems: 'center'
        }}
        title={t('panel_hint_console')}
      >
        {t('dock_console')}
        <span className="kbd">1</span>
        <span style={{ marginLeft: 'auto' }}>{t('c_power')}</span>
      </div>
      {/* 电源与机器控制 */}
      <Group title={t('c_power')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn ${power ? 'danger' : 'primary'}`}
            style={{ flex: 1 }}
            disabled={shutting || (snap?.suspended ?? false)}
            aria-label={power ? t('c_shutdown') : t('c_power_on')}
            onClick={() => (power ? lab.shutdown() : lab.power())}
          >
            {power ? t('c_shutdown') : t('c_power_on')}
          </button>
          <button
            className="btn"
            style={{ width: 64 }}
            onClick={lab.togglePause}
            disabled={!power || shutting || (snap?.suspended ?? false)}
            aria-label={lab.paused ? t('c_resume') : t('c_pause')}
          >
            {lab.paused ? t('c_resume') : t('c_pause')}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--dim)' }}>{t('c_shutdown_hint')}</div>
        <button
          className="btn"
          onClick={() => lab.kbd()}
          disabled={!power}
          aria-label={t('c_kbd')}
          style={{ width: '100%' }}
        >
          {t('c_kbd')}
        </button>
      </Group>

      {/* 进程装载 */}
      <Group title={t('c_spawn')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn"
            style={{ flex: 1 }}
            disabled={!power || shutting}
            onClick={() => lab.spawn('compute')}
            aria-label={t('c_spawn_compute')}
          >
            {t('c_spawn_compute')}
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            disabled={!power || shutting}
            onClick={() => lab.spawn('io')}
            aria-label={t('c_spawn_io')}
          >
            {t('c_spawn_io')}
          </button>
          <button
            className="btn"
            style={{ flex: 1 }}
            disabled={!power || shutting}
            onClick={() => lab.spawn('mixed')}
            aria-label={t('c_spawn_mixed')}
          >
            {t('c_spawn_mixed')}
          </button>
        </div>
        <Row label={t('c_speed')}>
          <select
            className="sel"
            style={{ width: '100%' }}
            value={sim.cfg.speed}
            onChange={(e) => lab.setCfg({ speed: Number(e.target.value) })}
            aria-label={t('c_speed')}
          >
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
            <option value={8}>8×</option>
          </select>
        </Row>
      </Group>

      {/* 调度参数 */}
      <Group title={t('c_algo')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {ALGOS.map((a) => (
            <button
              key={a}
              className={`btn ${sim.cfg.algo === a ? 'on' : ''}`}
              onClick={() => lab.setCfg({ algo: a })}
              aria-pressed={sim.cfg.algo === a}
              aria-label={t(`algo_${a}` as 'algo_fcfs')}
            >
              {t(`algo_${a}` as 'algo_fcfs')}
            </button>
          ))}
        </div>
        <Row label={t('c_quantum')}>
          <div>
            <input
              type="range"
              min={40}
              max={4000}
              step={20}
              value={sim.cfg.quantum}
              onChange={(e) => lab.setCfg({ quantum: Number(e.target.value) })}
              aria-label={t('c_quantum')}
            />
            <div style={{ fontSize: 10, color: 'var(--dim)' }}>
              {t('c_quantum_v', { n: sim.cfg.quantum })}
            </div>
          </div>
        </Row>
      </Group>

      {/* 粒子视图 */}
      <Group title={t('c_view')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`btn ${lab.viewMode === v ? 'on' : ''}`}
              onClick={() => lab.setViewMode(v)}
              aria-pressed={lab.viewMode === v}
              aria-label={t(`view_${v}` as 'view_data')}
            >
              {t(`view_${v}` as 'view_data')}
            </button>
          ))}
        </div>
      </Group>

      {/* 镜头 */}
      <Group title={t('c_camera')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {CAMS.map((c) => (
            <button
              key={c}
              className={`btn ${lab.camera === c ? 'warm-on' : ''}`}
              onClick={() => lab.setCamera(c)}
              aria-pressed={lab.camera === c}
              aria-label={t(`cam_${c}` as 'cam_global')}
            >
              {t(`cam_${c}` as 'cam_global')}
            </button>
          ))}
        </div>
      </Group>

      {/* 拆解与剖切 */}
      <Group title={t('c_explode')}>
        <Row label={t('c_explode')}>
          <div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={lab.explode}
              onChange={(e) => {
                lab.setAutoExplode(false);
                lab.setExplode(Number(e.target.value));
              }}
              aria-label={t('c_explode')}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={`btn ${lab.autoExplode ? 'on' : ''}`}
                style={{ flex: 1 }}
                onClick={() => {
                  lab.setAutoExplode(!lab.autoExplode);
                  if (!lab.autoExplode) lab.setExplode(0);
                }}
                aria-pressed={lab.autoExplode}
              >
                {t('c_explode_auto')}
              </button>
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={() => {
                  lab.setAutoExplode(false);
                  lab.setExplode(0);
                }}
                aria-label={t('c_assemble')}
              >
                {t('c_assemble')}
              </button>
            </div>
          </div>
        </Row>
        <Row label={t('c_section')}>
          <div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button
                className={`btn ${lab.section < 0 ? 'on' : ''}`}
                style={{ flex: 1 }}
                onClick={() => lab.setSection(-1)}
                aria-pressed={lab.section < 0}
              >
                {t('c_section_off')}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={lab.section < 0 ? 0 : lab.section}
                onChange={(e) => lab.setSection(Number(e.target.value))}
                disabled={lab.section < 0}
                aria-label={t('c_section')}
                style={{ flex: 1.4 }}
              />
            </div>
          </div>
        </Row>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {(
            [
              ['board', 'layer_board'],
              ['cpuLid', 'layer_cpu'],
              ['memShell', 'layer_mem'],
              ['diskShell', 'layer_disk']
            ] as const
          ).map(([k, lk]) => (
            <label
              key={k}
              style={{ fontSize: 10, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <input
                type="checkbox"
                checked={lab.layerAlpha[k] > 0.5}
                onChange={(e) => lab.setLayerAlpha({ [k]: e.target.checked ? 1 : 0.18 } as never)}
              />
              {t(lk)}
            </label>
          ))}
        </div>
      </Group>

      {/* 声音与标注 */}
      <Group title={t('c_sound')}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`btn ${lab.soundOn ? 'on' : ''}`}
            style={{ flex: 1 }}
            onClick={lab.toggleSound}
            aria-pressed={lab.soundOn}
          >
            {t('c_sound')} {lab.soundOn ? 'ON' : 'OFF'}
          </button>
          <button
            className={`btn ${lab.showLabels ? 'on' : ''}`}
            style={{ flex: 1 }}
            onClick={lab.toggleLabels}
            aria-pressed={lab.showLabels}
          >
            {t('c_labels')}
          </button>
        </div>
        <button className="btn" style={{ width: '100%' }} onClick={lab.resetSim}>
          {t('c_seed_v', { n: sim.cfg.seed })}
        </button>
      </Group>
      <div style={{ height: 4 }} />
    </div>
  );
}
