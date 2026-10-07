// 底部看板开关条:点击或按数字键 1-4 开关看板,0 为专注模式
import { useLab, type PanelKey } from '../state/store';
import { useT } from '../i18n';

const KEYS: { key: PanelKey; label: 'dock_console' | 'dock_metrics' | 'dock_cpu' | 'dock_narr'; kbd: string }[] = [
  { key: 'console', label: 'dock_console', kbd: '1' },
  { key: 'metrics', label: 'dock_metrics', kbd: '2' },
  { key: 'cpu', label: 'dock_cpu', kbd: '3' },
  { key: 'narrator', label: 'dock_narr', kbd: '4' }
];

export function PanelDock() {
  const t = useT();
  const panels = useLab((s) => s.panels);
  const togglePanel = useLab((s) => s.togglePanel);
  const toggleFocusMode = useLab((s) => s.toggleFocusMode);
  const anyOn = Object.values(panels).some(Boolean);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 4,
        zIndex: 15
      }}
      role="toolbar"
      aria-label={t('dock_hint')}
      title={t('dock_hint')}
    >
      {KEYS.map(({ key, label, kbd }) => (
        <button
          key={key}
          className={`btn ${panels[key] ? 'on' : ''}`}
          style={{ padding: '3px 9px', fontSize: 10 }}
          onClick={() => togglePanel(key)}
          aria-pressed={panels[key]}
          aria-label={t(label)}
          title={t(label)}
        >
          <span className="kbd">{kbd}</span> {t(label)}
        </button>
      ))}
      <div style={{ width: 1, background: 'var(--line-strong)', margin: '2px 4px' }} />
      <button
        className={`btn ${!anyOn ? 'warm-on' : ''}`}
        style={{ padding: '3px 9px', fontSize: 10 }}
        onClick={toggleFocusMode}
        aria-pressed={!anyOn}
        aria-label={t('dock_focus')}
        title={anyOn ? t('dock_focus') : t('dock_focus_on')}
      >
        <span className="kbd">0</span> {t('dock_focus')}
      </button>
    </div>
  );
}
