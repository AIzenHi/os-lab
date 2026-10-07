// 应用装配:布局 / WebGL 检测 / 键盘操作 / 移动端适配
import { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { MachineScene } from '../machine/MachineScene';
import { Lights } from '../scene/Lights';
import { CameraRig } from '../scene/Cameras';
import { useLab } from '../state/store';
import { useT } from '../i18n';
import { Console } from '../ui/Console';
import { MetricsPanel } from '../ui/MetricsPanel';
import { CpuPanel } from '../ui/CpuPanel';
import { TopBar } from '../ui/TopBar';
import { ChapterPanel, ChallengePanel, SlowMode, PartDetail } from '../ui/TeachPanels';
import { Narrator } from '../ui/Narrator';
import { GuideOverlay } from '../ui/GuideOverlay';
import { PanelDock } from '../ui/PanelDock';
import { FallbackPage, MobilePanels } from '../ui/Mobile';
import { sim } from '../kernel/sim';

function webglAvailable(): boolean {
  try {
    const cv = document.createElement('canvas');
    return !!(cv.getContext('webgl2') || cv.getContext('webgl'));
  } catch {
    return false;
  }
}

function useViewport(): { mobile: boolean } {
  const [w, setW] = useState(typeof window === 'undefined' ? 1280 : window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return { mobile: w < 820 };
}

function Notice() {
  const notice = useLab((s) => s.notice);
  const t = useT();
  if (!notice) return null;
  return (
    <div className="notice" role="alert">
      {t(notice as 'notice_explode_power')}
    </div>
  );
}

export function App() {
  const [gl, setGl] = useState<boolean | null>(null);
  const { mobile } = useViewport();
  const lab = useLab();

  useEffect(() => {
    setGl(webglAvailable());
  }, []);

  // 键盘操作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const s = useLab.getState();
      switch (e.key.toLowerCase()) {
        case 'p':
          if (sim.power) s.shutdown();
          else s.power();
          break;
        case ' ':
          e.preventDefault();
          s.togglePause();
          break;
        case 'l':
          s.spawn('mixed');
          break;
        case 'v': {
          const order = ['data', 'control', 'heat', 'writeback'] as const;
          s.setViewMode(order[(order.indexOf(s.viewMode) + 1) % order.length]);
          break;
        }
        case 'c': {
          const order = ['global', 'exec', 'mem', 'sched', 'free'] as const;
          s.setCamera(order[(order.indexOf(s.camera) + 1) % order.length]);
          break;
        }
        case 'e': {
          const cur = s.explode >= 1 ? 0 : Math.min(1, s.explode + 0.25);
          s.setAutoExplode(false);
          s.setExplode(cur);
          break;
        }
        case 'm':
          s.toggleSound();
          break;
        case '1':
          s.togglePanel('console');
          break;
        case '2':
          s.togglePanel('metrics');
          break;
        case '3':
          s.togglePanel('cpu');
          break;
        case '4':
          s.togglePanel('narrator');
          break;
        case '0':
          s.toggleFocusMode();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (gl === null) return null;
  if (!gl) {
    return (
      <div style={{ position: 'fixed', inset: 0 }}>
        <TopBar />
        <FallbackPage />
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)' }}>
      <Canvas
        shadows={false}
        dpr={[1, 1.75]}
        camera={{ position: [15, 21, 27], fov: 42, near: 0.1, far: 300 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#07080a');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        style={{ position: 'absolute', inset: 0 }}
        aria-label={lab.lang === 'zh' ? '三维实验台视图' : '3D laboratory view'}
      >
        <color attach="background" args={['#07080a']} />
        <fog attach="fog" args={['#07080a', 46, 110]} />
        <Suspense fallback={null}>
          <Lights />
          <MachineScene />
        </Suspense>
        <CameraRig />
      </Canvas>

      {/* HUD */}
      <TopBar />
      <Notice />
      {!mobile && (
        <>
          {lab.panels.console && <Console />}
          {lab.panels.metrics && <MetricsPanel />}
          {lab.panels.cpu && <CpuPanel />}
          {lab.panels.narrator && <Narrator />}
          <SlowMode />
          <ChapterPanel />
          <ChallengePanel />
          <PartDetail />
          <PanelDock />
        </>
      )}
      {mobile && (
        <>
          <MobilePanels />
          <Narrator />
        </>
      )}
      <GuideOverlay />
    </div>
  );
}
