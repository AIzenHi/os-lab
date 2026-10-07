// 新手引导浮层:五步卡片,首次打开自动出现,顶栏"入门"可随时重看
import { useEffect, useState } from 'react';
import { useLab } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';

const STEPS: { t: StringKey; b: StringKey }[] = [
  { t: 'g1_t', b: 'g1_b' },
  { t: 'g2_t', b: 'g2_b' },
  { t: 'g3_t', b: 'g3_b' },
  { t: 'g4_t', b: 'g4_b' },
  { t: 'g5_t', b: 'g5_b' }
];

export function GuideOverlay() {
  const t = useT();
  const guideOpen = useLab((s) => s.guideOpen);
  const setGuideSeen = useLab((s) => s.setGuideSeen);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (guideOpen) setStep(0);
  }, [guideOpen]);

  if (!guideOpen) return null;
  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const finish = () => setGuideSeen();
  const powerAndFinish = () => {
    setGuideSeen();
    const s = useLab.getState();
    if (!s.snapshot?.power) s.power();
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(4,5,7,0.82)',
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('guide_title')}
      onClick={finish}
    >
      <div
        className="panel"
        style={{ width: 620, maxWidth: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-title">
          {t('guide_title')}
          <span style={{ marginLeft: 8, color: 'var(--dim)' }}>
            {t('guide_step', { a: step + 1, b: STEPS.length })}
          </span>
          <button
            className="btn"
            style={{ padding: '1px 8px', marginLeft: 'auto' }}
            onClick={finish}
            aria-label={t('guide_skip')}
          >
            {t('guide_skip')}
          </button>
        </div>
        {/* 步骤指示点 */}
        <div style={{ display: 'flex', gap: 5, padding: '10px 16px 0' }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 3,
                background: i <= step ? 'var(--brass)' : 'var(--line)'
              }}
            />
          ))}
        </div>
        <div style={{ padding: '14px 20px 16px' }}>
          <div
            style={{
              fontSize: 16,
              color: 'var(--bone)',
              letterSpacing: '0.12em',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'baseline',
              gap: 10
            }}
          >
            <span style={{ color: 'var(--brass)', fontSize: 22 }}>{step + 1}</span>
            {t(cur.t)}
          </div>
          <div style={{ fontSize: 12, lineHeight: 2.1, color: '#c2c7cf' }}>{t(cur.b)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 20px 16px' }}>
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
            {t('guide_prev')}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={finish}>
            {t('guide_skip')}
          </button>
          {isLast ? (
            <button className="btn primary" onClick={powerAndFinish}>
              {t('guide_start')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              {t('guide_next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
