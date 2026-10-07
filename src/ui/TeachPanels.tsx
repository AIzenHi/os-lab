// 教学章节(五个)+ 故障挑战(三个)+ 慢速教学模式 + 部件详情
import { useEffect, useState } from 'react';
import { useLab, type ChallengeId } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';
import { sim } from '../kernel/sim';

interface ChapterDef {
  id: string;
  title: StringKey;
  pages: StringKey[];
  action: StringKey;
}

const CHAPTERS: ChapterDef[] = [
  { id: 'ch1', title: 'ch1', pages: ['ch1_p1', 'ch1_p2', 'ch1_p3'], action: 'ch1_act' },
  { id: 'ch2', title: 'ch2', pages: ['ch2_p1', 'ch2_p2', 'ch2_p3'], action: 'ch2_act' },
  { id: 'ch3', title: 'ch3', pages: ['ch3_p1', 'ch3_p2', 'ch3_p3'], action: 'ch3_act' },
  { id: 'ch4', title: 'ch4', pages: ['ch4_p1', 'ch4_p2', 'ch4_p3'], action: 'ch4_act' },
  { id: 'ch5', title: 'ch5', pages: ['ch5_p1', 'ch5_p2', 'ch5_p3'], action: 'ch5_act' }
];

export function ChapterPanel() {
  const t = useT();
  const lab = useLab();
  const active = lab.activeChapter;
  const chapter = CHAPTERS.find((c) => c.id === active);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [active]);

  if (!chapter) return null;
  const done = lab.chaptersDone.includes(chapter.id);
  const isLast = page === chapter.pages.length - 1;

  return (
    <div
      className="panel"
      style={{
        position: 'absolute',
        left: 296,
        bottom: 20,
        width: 420,
        maxWidth: 'calc(100vw - 570px)',
        zIndex: 20,
        boxShadow: '0 0 0 1px #000'
      }}
      role="dialog"
      aria-label={t(chapter.title)}
    >
      <div className="panel-title">
        {t('chapter_title')} · {t(chapter.title)}
        <span style={{ marginLeft: 'auto' }}>{t('chapter_page', { a: page + 1, b: chapter.pages.length })}</span>
        <button
          className="btn"
          style={{ padding: '1px 8px', marginLeft: 8 }}
          onClick={() => lab.setActiveChapter(null)}
          aria-label={t('chapter_close')}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '14px 16px', fontSize: 12, lineHeight: 1.9, letterSpacing: '0.06em' }}>
        {t(chapter.pages[page])}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 12px' }}>
        <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          {t('chapter_prev')}
        </button>
        <button
          className="btn"
          disabled={isLast}
          onClick={() => setPage(page + 1)}
        >
          {t('chapter_next')}
        </button>
        <div style={{ flex: 1 }} />
        {done ? (
          <span className="tag" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}>
            {t('chapter_done')}
          </span>
        ) : (
          <button
            className="btn primary"
            onClick={() => {
              lab.markChapterDone(chapter.id);
              if (chapter.id === 'ch1') {
                if (!sim.power) lab.power();
              } else if (chapter.id === 'ch2') {
                if (!sim.power) lab.power();
                else lab.spawn('mixed');
              } else if (chapter.id === 'ch5') {
                lab.startTrace('syscall');
                if (!sim.power) lab.power();
              } else if (!sim.power) {
                lab.power();
              }
            }}
          >
            {t(chapter.action)}
          </button>
        )}
      </div>
    </div>
  );
}

interface ChallengeDef {
  id: ChallengeId;
  title: StringKey;
  q: StringKey;
  options: StringKey[];
  correct: number;
  feedback: StringKey[];
  setup: () => void;
}

const CHALLENGES: ChallengeDef[] = [
  {
    id: 'deadlock',
    title: 'chal_deadlock',
    q: 'chal_deadlock_q',
    options: ['chal_deadlock_o1', 'chal_deadlock_o2', 'chal_deadlock_o3', 'chal_deadlock_o4'],
    correct: 1,
    feedback: ['chal_deadlock_w1', 'chal_deadlock_w2', 'chal_deadlock_w3', 'chal_deadlock_w4'],
    setup: () => {
      useLab.getState().resetSim();
      const lab = useLab.getState();
      lab.power();
      // 清空自动进程,装载死锁双雄
      window.setTimeout(() => {
        sim.procs.forEach((p) => {
          p.state = 'terminated';
        });
        sim.readyQueue = [];
        sim.pendingSpawns = [];
        sim.currentPid = null;
        sim.setConfig({ quantum: 40 });
        sim.spawnProcess('deadA');
        sim.spawnProcess('deadB');
      }, 1600);
    }
  },
  {
    id: 'thrash',
    title: 'chal_thrash',
    q: 'chal_thrash_q',
    options: ['chal_thrash_o1', 'chal_thrash_o2', 'chal_thrash_o3', 'chal_thrash_o4'],
    correct: 1,
    feedback: ['chal_thrash_w1', 'chal_thrash_w2', 'chal_thrash_w3', 'chal_thrash_w4'],
    setup: () => {
      useLab.getState().resetSim();
      const lab = useLab.getState();
      lab.power();
      window.setTimeout(() => {
        sim.procs.forEach((p) => {
          p.state = 'terminated';
        });
        sim.readyQueue = [];
        sim.pendingSpawns = [];
        sim.currentPid = null;
        sim.setConfig({ frames: 12, quantum: 600 });
        sim.spawnProcess('thrash');
        sim.spawnProcess('thrash');
        sim.spawnProcess('thrash');
      }, 1600);
    }
  },
  {
    id: 'starve',
    title: 'chal_starve',
    q: 'chal_starve_q',
    options: ['chal_starve_o1', 'chal_starve_o2', 'chal_starve_o3', 'chal_starve_o4'],
    correct: 2,
    feedback: ['chal_starve_w1', 'chal_starve_w2', 'chal_starve_w3', 'chal_starve_w4'],
    setup: () => {
      useLab.getState().resetSim();
      const lab = useLab.getState();
      lab.power();
      window.setTimeout(() => {
        sim.procs.forEach((p) => {
          p.state = 'terminated';
        });
        sim.readyQueue = [];
        sim.pendingSpawns = [];
        sim.currentPid = null;
        sim.setConfig({ algo: 'prio' });
        sim.spawnProcess('daemon');
        sim.spawnProcess('daemon');
        sim.spawnProcess('starveLow');
      }, 1600);
    }
  }
];

export function ChallengePanel() {
  const t = useT();
  const lab = useLab();
  const active = lab.activeChallenge;
  const def = CHALLENGES.find((c) => c.id === active);
  const [stage, setStage] = useState<'intro' | 'observe' | 'answered'>('intro');
  const [answer, setAnswer] = useState<number | null>(null);
  const [result, setResult] = useState<'pass' | 'fail' | null>(null);

  useEffect(() => {
    setStage('intro');
    setAnswer(null);
    setResult(null);
  }, [active]);

  if (!def) return null;
  const snap = lab.snapshot;

  return (
    <div
      className="panel"
      style={{
        position: 'absolute',
        left: 296,
        bottom: 20,
        width: 430,
        maxWidth: 'calc(100vw - 570px)',
        zIndex: 20
      }}
      role="dialog"
      aria-label={t(def.title)}
    >
      <div className="panel-title">
        {t('chal_title')} · {t(def.title)}
        <span
          className="tag"
          style={{
            marginLeft: 8,
            color:
              lab.challenges[def.id] === 'pass'
                ? 'var(--green)'
                : lab.challenges[def.id] === 'fail'
                  ? 'var(--alarm)'
                  : 'var(--dim)'
          }}
        >
          {lab.challenges[def.id] === 'pass'
            ? t('chal_pass')
            : lab.challenges[def.id] === 'fail'
              ? t('chal_fail')
              : t('chal_none')}
        </span>
        <button
          className="btn"
          style={{ padding: '1px 8px', marginLeft: 'auto' }}
          onClick={() => lab.setActiveChallenge(null)}
          aria-label={t('chapter_close')}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>{t(def.q)}</div>
        {stage === 'intro' && (
          <button
            className="btn primary"
            onClick={() => {
              def.setup();
              setStage('observe');
            }}
          >
            {t('chal_setup')}
          </button>
        )}
        {stage === 'observe' && (
          <div style={{ fontSize: 10, color: 'var(--dim)' }}>
            {t('chal_setup_done')}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <span>
                {t('m_cpu')} <b style={{ color: 'var(--cold)' }}>{((snap?.metrics.cpuUtil ?? 0) * 100).toFixed(0)}%</b>
              </span>
              <span>
                {t('m_fault')} <b style={{ color: 'var(--warm)' }}>{((snap?.metrics.faultRate ?? 0) * 100).toFixed(0)}%</b>
              </span>
              <span>
                {t('m_ctx')} <b>{snap?.metrics.ctxSwitches ?? 0}</b>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button className="btn" onClick={() => def.setup()}>
                {t('chal_retry')}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn primary" onClick={() => setStage('answered')}>
                {t('chal_question')}
              </button>
            </div>
          </div>
        )}
        {stage === 'answered' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {def.options.map((o, i) => (
              <button
                key={o}
                className={`btn ${answer === i ? 'on' : ''}`}
                style={{ textAlign: 'left', letterSpacing: '0.06em' }}
                onClick={() => setAnswer(i)}
                aria-pressed={answer === i}
              >
                {String.fromCharCode(65 + i)}. {t(o)}
              </button>
            ))}
            {answer !== null && (
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.8,
                  padding: '8px 10px',
                  border: `1px solid ${result === 'pass' ? 'var(--green)' : 'var(--alarm)'}`,
                  color: result === 'pass' ? 'var(--green)' : 'var(--alarm)'
                }}
                role="status"
              >
                {result === 'pass' ? t('chal_correct') : t('chal_wrong')}
                <div style={{ color: 'var(--bone)', marginTop: 4 }}>{t(def.feedback[answer])}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn"
                disabled={answer === null}
                onClick={() => {
                  if (answer === null) return;
                  const r = answer === def.correct ? 'pass' : 'fail';
                  setResult(r);
                  lab.setChallengeResult(def.id, r);
                }}
              >
                {t('chal_answer')}
              </button>
              <button className="btn" onClick={() => def.setup()}>
                {t('chal_retry')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 慢速教学模式:跟随一条指令 / 追踪一次系统调用 */
export function SlowMode() {
  const t = useT();
  const lab = useLab();
  const snap = lab.snapshot;
  const mode = snap?.trace.mode ?? null;
  const [steps, setSteps] = useState<{ key: string; pid?: number; num?: number; vpn?: number; sys?: string }[]>([]);

  useEffect(() => {
    if (!mode) return;
    setSteps((snap?.trace.steps ?? []).slice().reverse());
  }, [snap?.trace.steps, mode, snap?.trace.steps.length]);

  if (!mode) return null;
  return (
    <div
      className="panel"
      style={{
        position: 'absolute',
        left: 296,
        top: 64,
        width: 430,
        maxWidth: 'calc(100vw - 570px)',
        zIndex: 21
      }}
      role="status"
      aria-label={t('trace_active')}
    >
      <div className="panel-title">
        {t('trace_active')} · {mode === 'instr' ? t('slow_instr') : t('slow_syscall')}
        <button
          className="btn"
          style={{ padding: '1px 8px', marginLeft: 'auto' }}
          onClick={() => lab.stopTrace()}
          aria-label={t('slow_exit')}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 300, overflowY: 'auto' }}>
        {steps.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.8 }}>
            {snap?.power
              ? mode === 'instr'
                ? t('slow_wait_instr')
                : t('slow_wait_syscall')
              : t('slow_wait_power')}
          </div>
        )}
        {steps.map((s, i) => (
          <div
            key={`${s.key}:${i}`}
            style={{
              fontSize: 11,
              lineHeight: 1.7,
              color: i === 0 ? 'var(--cold)' : '#9aa0a8',
              display: 'flex',
              gap: 8
            }}
          >
            <span style={{ color: '#565c66', minWidth: 30 }}>{i === 0 ? '▶' : ''}</span>
            <span>{t(s.key as StringKey, { pc: s.num ?? '', vpn: s.vpn ?? s.num ?? '', pid: s.pid ?? '', sys: s.sys ?? '' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 部件详情浮层:点击部件后显示描述 + 关联指标 + 关联阶段 */
export function PartDetail() {
  const t = useT();
  const lab = useLab();
  const part = lab.selectedPart;
  if (!part) return null;
  const labelKey = `part_${part}` as StringKey;
  const descKey = `part_${part}_d` as StringKey;
  return (
    <div
      className="panel"
      style={{
        position: 'absolute',
        right: 276,
        bottom: 20,
        width: 330,
        maxWidth: 'calc(100vw - 600px)',
        zIndex: 20
      }}
      role="dialog"
      aria-label={t(labelKey)}
    >
      <div className="panel-title">
        {t(labelKey)}
        <button
          className="btn"
          style={{ padding: '1px 8px', marginLeft: 'auto' }}
          onClick={() => lab.selectPart(null)}
          aria-label={t('chapter_close')}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '10px 14px', fontSize: 11, lineHeight: 1.8, letterSpacing: '0.04em' }}>
        {t(descKey)}
      </div>
    </div>
  );
}
