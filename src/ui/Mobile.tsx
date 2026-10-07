// WebGL 降级页 + 移动端面板
import { useLab } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';
import { useEffect, useState } from 'react';
import { sim } from '../kernel/sim';
import { downloadReport } from './report';

export function FallbackPage() {
  const t = useT();
  const lab = useLab();
  const chapters: StringKey[] = ['ch1_p1', 'ch2_p1', 'ch3_p1', 'ch4_p1', 'ch5_p1'];
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'var(--bg)', padding: 20 }}>
      <div className="panel" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="panel-title">{t('fallback_title')}</div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>{t('fallback_body')}</div>
          {/* 教学内容仍可阅读 */}
          {chapters.map((k) => (
            <div key={k} style={{ border: '1px solid var(--line)', padding: '10px 14px', fontSize: 11, lineHeight: 1.9 }}>
              {t(k)}
            </div>
          ))}
          <button
            className="btn primary"
            onClick={() =>
              downloadReport({
                lang: lab.lang,
                chaptersDone: lab.chaptersDone,
                viewMode: lab.viewMode,
                camera: lab.camera,
                explode: lab.explode,
                section: lab.section,
                challenges: lab.challenges,
                snapshot: lab.snapshot ?? sim.snapshot()
              })
            }
          >
            {t('c_report')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 移动端:底部标签切换三个抽屉面板 */
export function MobilePanels() {
  const t = useT();
  const lab = useLab();
  const [tab, setTab] = useState<'console' | 'metrics' | 'teach' | null>(null);
  useEffect(() => {
    lab.setMobilePanel(tab);
    void lab;
  }, [tab]);

  return (
    <>
      {tab !== null && (
        <div
          className="panel"
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 54,
            top: 60,
            zIndex: 26,
            overflowY: 'auto',
            background: 'rgba(12,14,18,0.97)'
          }}
          role="dialog"
          aria-label={t(`mobile_${tab}` as 'mobile_console')}
        >
          <div className="panel-title">
            {t(`mobile_${tab}` as 'mobile_console')}
            <button
              className="btn"
              style={{ padding: '1px 8px', marginLeft: 'auto' }}
              onClick={() => setTab(null)}
              aria-label={t('mobile_close')}
            >
              ×
            </button>
          </div>
          <div style={{ padding: 10 }}>
            {tab === 'console' && <ConsoleContent />}
            {tab === 'metrics' && <MetricsContent />}
            {tab === 'teach' && <TeachContent />}
          </div>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          left: 8,
          right: 8,
          bottom: 8,
          height: 40,
          display: 'flex',
          gap: 6,
          zIndex: 26
        }}
        role="tablist"
      >
        {(['console', 'metrics', 'teach'] as const).map((k) => (
          <button
            key={k}
            className={`btn ${tab === k ? 'on' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setTab(tab === k ? null : k)}
            role="tab"
            aria-selected={tab === k}
            aria-label={t(`mobile_${k}` as 'mobile_console')}
          >
            {t(`mobile_${k}` as 'mobile_console')}
          </button>
        ))}
      </div>
    </>
  );
}

// 移动端复用桌面面板的简化内容:直接引入桌面组件受宽度影响,这里以指针事件容器呈现
import { Console } from './Console';
import { MetricsPanel } from './MetricsPanel';
import { ChapterPanel, ChallengePanel, SlowMode, PartDetail } from './TeachPanels';
import { TopBar } from './TopBar';
import { CpuPanel } from './CpuPanel';

function ConsoleContent() {
  return <div style={{ pointerEvents: 'auto' }}><Console /></div>;
}
function MetricsContent() {
  return <div style={{ pointerEvents: 'auto' }}><MetricsPanel /></div>;
}
function TeachContent() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <TopBar />
      <ChapterPanel />
      <ChallengePanel />
      <SlowMode />
      <PartDetail />
      <CpuPanel />
    </div>
  );
}
