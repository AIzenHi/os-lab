// 顶栏:标题铭牌 / 语言切换 / 章节入口 / 故障挑战 / 慢速模式 / 结果图
import { useLab, type ChallengeId } from '../state/store';
import { useT } from '../i18n';
import { downloadReport } from './report';
import { sim } from '../kernel/sim';

const CHAPTERS = [
  { id: 'ch1', label: 'ch1' },
  { id: 'ch2', label: 'ch2' },
  { id: 'ch3', label: 'ch3' },
  { id: 'ch4', label: 'ch4' },
  { id: 'ch5', label: 'ch5' }
] as const;

const CHALLENGES: ChallengeId[] = ['deadlock', 'thrash', 'starve'];

export function TopBar() {
  const t = useT();
  const lab = useLab();
  const snap = lab.snapshot;
  const traceActive = snap?.trace.mode != null;

  return (
    <div
      className="panel"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        zIndex: 25
      }}
      role="toolbar"
      aria-label={t('app_title')}
    >
      <span
        className="nameplate"
        style={{ fontSize: 12, letterSpacing: '0.3em', padding: '3px 12px' }}
      >
        {t('app_title')}
      </span>
      <span style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.18em' }}>
        {t('app_sub')}
      </span>
      <div style={{ flex: 1 }} />
      {/* 教学章节 */}
      <div style={{ display: 'flex', gap: 3 }}>
        {CHAPTERS.map((c) => {
          const done = lab.chaptersDone.includes(c.id);
          const open = lab.activeChapter === c.id;
          return (
            <button
              key={c.id}
              className={`btn ${open ? 'on' : ''}`}
              style={{ padding: '3px 8px', fontSize: 10, borderColor: done ? 'var(--green)' : undefined }}
              onClick={() => {
                lab.setActiveChallenge(null);
                lab.setActiveChapter(open ? null : c.id);
              }}
              aria-pressed={open}
              title={t(c.label)}
            >
              {t(c.label)}
              {done ? ' ✓' : ''}
            </button>
          );
        })}
      </div>
      <div style={{ width: 1, height: 20, background: 'var(--line-strong)' }} />
      {/* 故障挑战 */}
      <div style={{ display: 'flex', gap: 3 }}>
        {CHALLENGES.map((id) => {
          const r = lab.challenges[id];
          const open = lab.activeChallenge === id;
          return (
            <button
              key={id}
              className={`btn ${open ? 'warm-on' : ''}`}
              style={{
                padding: '3px 8px',
                fontSize: 10,
                borderColor: r === 'pass' ? 'var(--green)' : open ? 'var(--warm)' : undefined
              }}
              onClick={() => {
                lab.setActiveChapter(null);
                lab.setActiveChallenge(open ? null : id);
              }}
              aria-pressed={open}
              title={t(`chal_${id}` as 'chal_deadlock')}
            >
              {t(`chal_${id}` as 'chal_deadlock').replace(/^(挑战[一二三]:|Challenge [123]:)/, '')}
              {r === 'pass' ? ' ✓' : r === 'fail' ? ' ×' : ''}
            </button>
          );
        })}
      </div>
      <div style={{ width: 1, height: 20, background: 'var(--line-strong)' }} />
      {/* 慢速模式 */}
      <div style={{ display: 'flex', gap: 3 }}>
        <button
          className={`btn ${traceActive ? 'on' : ''}`}
          style={{ padding: '3px 8px', fontSize: 10 }}
          disabled={traceActive}
          onClick={() => {
            lab.setCfg({ speed: 0.25 });
            lab.startTrace('instr');
          }}
          aria-label={t('slow_instr')}
        >
          {t('slow_instr')}
        </button>
        <button
          className={`btn ${traceActive ? 'on' : ''}`}
          style={{ padding: '3px 8px', fontSize: 10 }}
          disabled={traceActive}
          onClick={() => {
            lab.setCfg({ speed: 0.25 });
            lab.startTrace('syscall');
          }}
          aria-label={t('slow_syscall')}
        >
          {t('slow_syscall')}
        </button>
      </div>
      <div style={{ width: 1, height: 20, background: 'var(--line-strong)' }} />
      <button
        className="btn"
        style={{ padding: '3px 8px', fontSize: 10 }}
        onClick={() => {
          const s = useLab.getState();
          downloadReport({
            lang: s.lang,
            chaptersDone: s.chaptersDone,
            viewMode: s.viewMode,
            camera: s.camera,
            explode: s.explode,
            section: s.section,
            challenges: s.challenges,
            snapshot: s.snapshot ?? sim.snapshot()
          });
        }}
        aria-label={t('c_report')}
      >
        {t('c_report')}
      </button>
      <button
        className="btn"
        style={{ padding: '3px 10px', fontSize: 10 }}
        onClick={() => lab.setGuideOpen(true)}
        aria-label={t('guide_title')}
        title={t('guide_title')}
      >
        {t('guide_btn')}
      </button>
      <button
        className="btn"
        style={{ padding: '3px 10px', fontSize: 10 }}
        onClick={() => lab.setLang(lab.lang === 'zh' ? 'en' : 'zh')}
        aria-label={lab.lang === 'zh' ? 'English' : '中文'}
      >
        {t('lang_switch')}
      </button>
    </div>
  );
}
