// 中央状态管理:统一驱动交互(Zustand)
import { create } from 'zustand';
import { sim, type SimSnapshot } from '../kernel/sim';
import type { ProcRole, SimConfig } from '../kernel/types';

export type ViewMode = 'data' | 'control' | 'heat' | 'writeback';
export type CameraPreset = 'global' | 'exec' | 'mem' | 'sched' | 'free';
export type Lang = 'zh' | 'en';
export type ChallengeId = 'deadlock' | 'thrash' | 'starve';

export const SAFE_EXPLODE = 0.6; // 拆解安全阈值:超过则挂起时钟、禁止上电

export interface LayerAlpha {
  board: number;
  cpuLid: number;
  memShell: number;
  diskShell: number;
}

/** 常驻看板开关(快捷键 1-4 / 0 专注模式) */
export type PanelKey = 'console' | 'metrics' | 'cpu' | 'narrator';
export type Panels = Record<PanelKey, boolean>;

interface LabState {
  lang: Lang;
  viewMode: ViewMode;
  camera: CameraPreset;
  explode: number; // 0..1 连续爆炸
  autoExplode: boolean; // 连续爆炸拆解动画
  section: number; // -1 关闭; 0..1 剖切位置
  layerAlpha: LayerAlpha;
  showLabels: boolean;
  selectedPart: string | null;
  selectedPhase: string | null;
  soundOn: boolean;
  paused: boolean;
  reducedMotion: boolean;
  mobilePanel: 'console' | 'metrics' | 'teach' | null;
  panels: Panels;
  guideOpen: boolean;
  guideSeen: boolean;
  chaptersDone: string[];
  challenges: Record<ChallengeId, 'pass' | 'fail' | null>;
  activeChapter: string | null;
  activeChallenge: ChallengeId | null;
  notice: string | null; // 临时提示(如“拆解超限,禁止上电”)
  snapshot: SimSnapshot | null;

  setLang: (l: Lang) => void;
  setViewMode: (v: ViewMode) => void;
  setCamera: (c: CameraPreset) => void;
  setExplode: (v: number) => void;
  setAutoExplode: (b: boolean) => void;
  setSection: (v: number) => void;
  setLayerAlpha: (patch: Partial<LayerAlpha>) => void;
  toggleLabels: () => void;
  togglePanel: (key: PanelKey) => void;
  toggleFocusMode: () => void;
  setGuideOpen: (open: boolean) => void;
  setGuideSeen: () => void;
  selectPart: (id: string | null) => void;
  selectPhase: (id: string | null) => void;
  toggleSound: () => void;
  togglePause: () => void;
  setMobilePanel: (p: LabState['mobilePanel']) => void;
  setNotice: (n: string | null) => void;
  setSnapshot: (s: SimSnapshot) => void;
  setActiveChapter: (id: string | null) => void;
  setActiveChallenge: (id: ChallengeId | null) => void;
  markChapterDone: (id: string) => void;
  setChallengeResult: (id: ChallengeId, r: 'pass' | 'fail') => void;

  // 直通模拟内核的命令
  power: () => void;
  shutdown: () => void;
  spawn: (role: ProcRole) => void;
  kbd: () => void;
  setCfg: (patch: Partial<SimConfig>) => void;
  resetSim: () => void;
  startTrace: (mode: 'instr' | 'syscall') => void;
  stopTrace: () => void;
}

const LS_KEY = 'oslab.state.v1';

interface PersistShape {
  lang?: Lang;
  chaptersDone?: string[];
  challenges?: Record<ChallengeId, 'pass' | 'fail' | null>;
  soundOn?: boolean;
  guideSeen?: boolean;
}

function loadPersist(): PersistShape {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as PersistShape) : {};
  } catch {
    return {};
  }
}

function savePersist(s: LabState): void {
  try {
    const data: PersistShape = {
      lang: s.lang,
      chaptersDone: s.chaptersDone,
      challenges: s.challenges,
      soundOn: s.soundOn,
      guideSeen: s.guideSeen
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

const persisted = typeof window !== 'undefined' ? loadPersist() : {};

const applyExplode = (v: number): number => {
  const clamped = Math.max(0, Math.min(1, v));
  // 拆解超过安全检查范围:自动挂起时钟、暂停总线数据流
  sim.setSuspended(clamped > SAFE_EXPLODE);
  return clamped;
};

export const useLab = create<LabState>((set, get) => ({
  lang: persisted.lang ?? 'zh',
  viewMode: 'data',
  camera: 'global',
  explode: 0,
  autoExplode: false,
  section: -1,
  layerAlpha: { board: 1, cpuLid: 1, memShell: 1, diskShell: 1 },
  showLabels: true,
  selectedPart: null,
  selectedPhase: null,
  soundOn: persisted.soundOn ?? false,
  paused: false,
  reducedMotion:
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  mobilePanel: null,
  panels: { console: true, metrics: true, cpu: true, narrator: true },
  guideOpen: !persisted.guideSeen,
  guideSeen: persisted.guideSeen ?? false,
  chaptersDone: persisted.chaptersDone ?? [],
  challenges: persisted.challenges ?? { deadlock: null, thrash: null, starve: null },
  activeChapter: null,
  activeChallenge: null,
  notice: null,
  snapshot: null,

  setLang: (l) => {
    set({ lang: l });
    savePersist(get());
  },
  setViewMode: (v) => set({ viewMode: v }),
  setCamera: (c) => set({ camera: c }),
  setExplode: (v) => set({ explode: applyExplode(v) }),
  setAutoExplode: (b) => set({ autoExplode: b }),
  setSection: (v) => set({ section: v }),
  setLayerAlpha: (patch) => set({ layerAlpha: { ...get().layerAlpha, ...patch } }),
  toggleLabels: () => set({ showLabels: !get().showLabels }),
  togglePanel: (key) => set({ panels: { ...get().panels, [key]: !get().panels[key] } }),
  toggleFocusMode: () => {
    const cur = get().panels;
    const anyOn = Object.values(cur).some(Boolean);
    set({
      panels: anyOn
        ? { console: false, metrics: false, cpu: false, narrator: false }
        : { console: true, metrics: true, cpu: true, narrator: true }
    });
  },
  setGuideOpen: (open) => set({ guideOpen: open }),
  setGuideSeen: () => {
    set({ guideSeen: true, guideOpen: false });
    savePersist(get());
  },
  selectPart: (id) => set({ selectedPart: id }),
  selectPhase: (id) => set({ selectedPhase: id }),
  toggleSound: () => {
    set({ soundOn: !get().soundOn });
    savePersist(get());
  },
  togglePause: () => set({ paused: !get().paused }),
  setMobilePanel: (p) => set({ mobilePanel: p }),
  setNotice: (n) => set({ notice: n }),
  setSnapshot: (s) => set({ snapshot: s }),
  setActiveChapter: (id) => set({ activeChapter: id }),
  setActiveChallenge: (id) => set({ activeChallenge: id }),
  markChapterDone: (id) => {
    if (!get().chaptersDone.includes(id)) {
      set({ chaptersDone: [...get().chaptersDone, id] });
      savePersist(get());
    }
  },
  setChallengeResult: (id, r) => {
    const cur = get().challenges[id];
    // 已通过的成绩不被失败覆盖
    if (cur === 'pass' && r === 'fail') return;
    set({ challenges: { ...get().challenges, [id]: r } });
    savePersist(get());
  },

  power: () => {
    const s = get();
    if (sim.power) return;
    if (sim.suspended || s.explode > SAFE_EXPLODE) {
      sim.setSuspended(true);
      set({ notice: 'notice_explode_power' });
      return;
    }
    sim.powerOn();
    set({ paused: false });
  },
  shutdown: () => {
    sim.requestShutdown();
  },
  spawn: (role) => {
    sim.spawnProcess(role);
  },
  kbd: () => {
    sim.triggerKbd();
  },
  setCfg: (patch) => {
    sim.setConfig(patch);
    set({ snapshot: sim.snapshot() });
  },
  resetSim: () => {
    sim.reset({ seed: sim.cfg.seed });
    set({ snapshot: sim.snapshot() });
  },
  startTrace: (mode) => {
    sim.startTrace(mode);
    set({ paused: false });
  },
  stopTrace: () => {
    sim.stopTrace();
  }
}));
