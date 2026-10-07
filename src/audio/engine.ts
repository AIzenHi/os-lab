// Web Audio 程序化合成引擎:全部音效由振荡器/噪声实时生成
// 音高与音量随系统阶段和负载平滑变化
export interface AudioLoadState {
  power: boolean;
  util: number; // 0..1
  temp: number; // 22..56
  freq: number; // 0..1 主频
  fan: number; // 0..1 风扇
  alarm: boolean; // 故障警报(死锁等)
}

type CtxLike = AudioContext;
type OscLike = OscillatorNode;

export class AudioEngine {
  private ctx: CtxLike | null = null;
  private master: GainNode | null = null;
  private fanGain: GainNode | null = null;
  private fanFilter: BiquadFilterNode | null = null;
  private humOsc: OscLike | null = null;
  private humGain: GainNode | null = null;
  private alarmTimer: number | null = null;
  private lastTick = 0;
  enabled = false;
  private noiseBuf: AudioBuffer | null = null;

  constructor(private ctxFactory: () => CtxLike = () => new AudioContext()) {}

  /** 首次用户手势时调用(浏览器自动播放策略) */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = this.ctxFactory();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // 风扇:循环白噪 + 低通
    this.noiseBuf = this.makeNoise(ctx);
    const fanSrc = ctx.createBufferSource();
    fanSrc.buffer = this.noiseBuf;
    fanSrc.loop = true;
    this.fanFilter = ctx.createBiquadFilter();
    this.fanFilter.type = 'lowpass';
    this.fanFilter.frequency.value = 420;
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    fanSrc.connect(this.fanFilter).connect(this.fanGain).connect(this.master);
    void fanSrc.start();

    // 主频哼声
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sine';
    this.humOsc.frequency.value = 120;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humOsc.connect(this.humGain).connect(this.master);
    void this.humOsc.start();
  }

  private makeNoise(ctx: CtxLike): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      // 粉红化噪声:低频能量更高,更像风道
      v = v * 0.97 + (Math.random() * 2 - 1) * 0.03;
      data[i] = v * 6;
    }
    return buf;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.ensure();
    if (this.master && this.ctx) {
      const target = on ? 0.5 : 0.0;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
    }
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    sweepTo?: number
  ): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), ctx.currentTime + dur);
    }
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, cutoff: number): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.02);
  }

  // ---- 事件音效 ----

  procLoad(): void {
    // 装载:上行琶音
    [330, 415, 494, 660].forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.12, 'triangle', 0.18), i * 55);
    });
  }

  pipelineTick(stage: number): void {
    // 流水线节拍:按段位微调音高(节流)
    const now = performance.now();
    if (now - this.lastTick < 90) return;
    this.lastTick = now;
    this.blip(180 + stage * 24, 0.035, 'square', 0.045);
  }

  cacheHit(level: string): void {
    // 命中脉冲:层级越高音高越低
    const f = level === 'l1i' || level === 'l1d' ? 1240 : level === 'l2' ? 930 : 700;
    this.blip(f, 0.05, 'sine', 0.1);
  }

  cacheMiss(): void {
    this.blip(240, 0.08, 'triangle', 0.08, 170);
  }

  pageFault(): void {
    // 缺页换页:下滑 + 磁头寻道噪声
    this.blip(520, 0.5, 'sawtooth', 0.1, 90);
    this.noiseBurst(0.4, 0.06, 900);
  }

  ctxSwitch(): void {
    // 上下文切换:双击
    this.blip(520, 0.05, 'square', 0.12);
    setTimeout(() => this.blip(660, 0.05, 'square', 0.1), 70);
  }

  interrupt(): void {
    // 中断蜂鸣:经典双音
    this.blip(880, 0.08, 'square', 0.12);
    setTimeout(() => this.blip(880, 0.08, 'square', 0.1), 110);
  }

  diskIO(): void {
    this.noiseBurst(0.18, 0.05, 1600);
  }

  faultAlarm(): void {
    if (this.alarmTimer !== null) return;
    const beep = () => {
      if (!this.enabled) {
        this.stopAlarm();
        return;
      }
      this.blip(620, 0.14, 'square', 0.1);
      setTimeout(() => this.blip(440, 0.14, 'square', 0.1), 180);
    };
    beep();
    this.alarmTimer = setInterval(beep, 900);
  }

  stopAlarm(): void {
    if (this.alarmTimer !== null) {
      clearInterval(this.alarmTimer);
      this.alarmTimer = null;
    }
  }

  shutdownGlide(): void {
    // 停机惰转:主频下滑 + 风扇渐隐(由 update 完成渐隐)
    this.blip(420, 1.6, 'sine', 0.12, 60);
    this.blip(210, 1.8, 'triangle', 0.08, 40);
  }

  bootBeep(): void {
    // 自检通过提示音
    this.blip(990, 0.16, 'square', 0.14);
  }

  // ---- 连续状态:风扇 / 主频 / 警报 ----

  update(state: AudioLoadState): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    if (!state.power) {
      this.fanGain?.gain.setTargetAtTime(0, now, 0.4);
      this.humGain?.gain.setTargetAtTime(0, now, 0.2);
      this.stopAlarm();
      return;
    }
    const fanTarget = 0.03 + state.fan * 0.16;
    this.fanGain?.gain.setTargetAtTime(fanTarget, now, 0.5);
    if (this.fanFilter) {
      this.fanFilter.frequency.setTargetAtTime(360 + state.fan * 420, now, 0.5);
    }
    if (this.humOsc && this.humGain) {
      this.humOsc.frequency.setTargetAtTime(90 + state.freq * 150, now, 0.3);
      this.humGain.gain.setTargetAtTime(0.02 + state.util * 0.03, now, 0.4);
    }
    if (state.alarm) this.faultAlarm();
    else this.stopAlarm();
  }

  dispose(): void {
    this.stopAlarm();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }
}

export const audioEngine = new AudioEngine();
