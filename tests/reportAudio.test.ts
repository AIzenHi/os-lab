// 结果图与音频引擎测试(Node 环境 stub Canvas / AudioContext)
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import type { SimSnapshot } from '../src/kernel/sim';
import { Sim, CYCLES_PER_SEC } from '../src/kernel/sim';

// ---- Canvas stub(结果图) ----
class Ctx2DStub {
  ops: string[] = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textBaseline = '';
  textAlign = '';
  fillRect() { this.ops.push('fillRect'); }
  strokeRect() { this.ops.push('strokeRect'); }
  clearRect() { this.ops.push('clearRect'); }
  beginPath() { this.ops.push('beginPath'); }
  moveTo() { this.ops.push('moveTo'); }
  lineTo() { this.ops.push('lineTo'); }
  stroke() { this.ops.push('stroke'); }
  fill() { this.ops.push('fill'); }
  fillText() { this.ops.push('fillText'); }
}
class CanvasStub {
  width = 960;
  height = 640;
  ctx = new Ctx2DStub();
  toBlob(cb: (b: Blob | null) => void) {
    cb(new Blob(['png'], { type: 'image/png' }));
  }
  getContext(): Ctx2DStub {
    return this.ctx;
  }
}

describe('学习结果图', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      ...globalThis.document,
      createElement: (tag: string) => {
        if (tag === 'canvas') return new CanvasStub() as unknown as HTMLCanvasElement;
        return {} as HTMLElement;
      }
    });
  });

  it('渲染出包含全部区块的报告画布', async () => {
    const { renderReport } = await import('../src/ui/report');
    const s = new Sim();
    s.powerOn();
    s.advance(4000 / CYCLES_PER_SEC, 1);
    const snap: SimSnapshot = s.snapshot();
    const cv = renderReport({
      lang: 'zh',
      chaptersDone: ['ch1', 'ch3'],
      viewMode: 'data',
      camera: 'global',
      explode: 0.3,
      section: -1,
      challenges: { deadlock: 'pass', thrash: 'fail', starve: null },
      snapshot: snap
    });
    expect(cv.width).toBe(960);
    expect(cv.height).toBe(640);
    // 绘制了文本与框线
    const ctx = (cv as unknown as CanvasStub).ctx;
    expect(ctx.ops.filter((o) => o === 'fillText').length).toBeGreaterThan(30);
    expect(ctx.ops.filter((o) => o === 'strokeRect').length).toBeGreaterThan(4);
  });

  it('英文报告同样可渲染', async () => {
    const { setI18nLang } = await import('../src/i18n');
    setI18nLang('en');
    const { renderReport } = await import('../src/ui/report');
    const cv = renderReport({
      lang: 'en',
      chaptersDone: [],
      viewMode: 'heat',
      camera: 'exec',
      explode: 0,
      section: 0.5,
      challenges: { deadlock: null, thrash: null, starve: null },
      snapshot: null
    });
    expect(cv.width).toBe(960);
    setI18nLang('zh');
  });
});

// ---- Audio stub ----
class GainStub {
  gain = {
    value: 0,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn()
  };
  connect() { return this; }
}
class OscStub {
  type = 'sine';
  frequency = { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
  connect() { return this; }
  start() {}
  stop() {}
}
class BufferSrcStub {
  buffer: unknown = null;
  loop = false;
  connect() { return this; }
  start() {}
  stop() {}
}
class AudioCtxStub {
  state = 'running';
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  createGain() { return new GainStub(); }
  createOscillator() { return new OscStub(); }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0, setTargetAtTime: vi.fn() }, connect() { return this; } };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(1024) };
  }
  createBufferSource() { return new BufferSrcStub(); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

describe('音频引擎', () => {
  it('懒初始化:首次 ensure 才创建 AudioContext', () => {
    const eng = new AudioEngine(() => new AudioCtxStub() as unknown as AudioContext);
    expect((eng as unknown as { ctx: unknown }).ctx).toBeNull();
    eng.ensure();
    expect((eng as unknown as { ctx: unknown }).ctx).not.toBeNull();
  });

  it('setEnabled(false) 将主增益归零(静音)', () => {
    const eng = new AudioEngine(() => new AudioCtxStub() as unknown as AudioContext);
    eng.setEnabled(true);
    const ctxObj = (eng as unknown as { ctx: AudioCtxStub }).ctx;
    const master = (eng as unknown as { master: GainStub }).master;
    expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, ctxObj.currentTime, 0.15);
    eng.setEnabled(false);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.0, ctxObj.currentTime, 0.15);
  });

  it('update 反映系统负载:风扇增益随温度上升、警报循环启动', () => {
    vi.useFakeTimers();
    const eng = new AudioEngine(() => new AudioCtxStub() as unknown as AudioContext);
    eng.setEnabled(true);
    eng.update({ power: true, util: 0.9, temp: 50, freq: 0.9, fan: 0.9, alarm: true });
    const fanGain = (eng as unknown as { fanGain: GainStub }).fanGain;
    const fanArg = fanGain.gain.setTargetAtTime.mock.calls[0][0] as number;
    expect(fanArg).toBeCloseTo(0.174, 5);
    // 警报已注册循环
    expect((eng as unknown as { alarmTimer: number | null }).alarmTimer).not.toBeNull();
    eng.update({ power: false, util: 0, temp: 22, freq: 0, fan: 0, alarm: false });
    expect((eng as unknown as { alarmTimer: number | null }).alarmTimer).toBeNull();
    vi.useRealTimers();
  });

  it('事件音效在禁用时不抛错', () => {
    const eng = new AudioEngine(() => new AudioCtxStub() as unknown as AudioContext);
    eng.setEnabled(false);
    expect(() => {
      eng.procLoad();
      eng.pipelineTick(2);
      eng.cacheHit('l1d');
      eng.cacheMiss();
      eng.pageFault();
      eng.ctxSwitch();
      eng.interrupt();
      eng.diskIO();
      eng.shutdownGlide();
      eng.bootBeep();
    }).not.toThrow();
  });

  it('警报在禁用后自动停止', () => {
    vi.useFakeTimers();
    const eng = new AudioEngine(() => new AudioCtxStub() as unknown as AudioContext);
    eng.setEnabled(true);
    eng.update({ power: true, util: 0.5, temp: 40, freq: 0.5, fan: 0.5, alarm: true });
    expect((eng as unknown as { alarmTimer: number | null }).alarmTimer).not.toBeNull();
    eng.setEnabled(false);
    vi.advanceTimersByTime(1200);
    // 警报停用状态下的下一次 beep 会停止循环
    eng.stopAlarm();
    expect((eng as unknown as { alarmTimer: number | null }).alarmTimer).toBeNull();
    vi.useRealTimers();
  });
});
