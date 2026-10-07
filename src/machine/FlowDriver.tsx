// 帧驱动:模拟内核推进 -> 粒子生成 -> 音频事件 -> 快照发布(单循环源)
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { sim, CYCLES_PER_SEC } from '../kernel/sim';
import { flow } from '../flow';
import { audioEngine } from '../audio/engine';
import { useLab } from '../state/store';
import { FlowSystem } from '../flow';

export function FlowDriver() {
  const paused = useLab((s) => s.paused);
  const soundOn = useLab((s) => s.soundOn);
  const viewMode = useLab((s) => s.viewMode);
  const reduced = useLab((s) => s.reducedMotion);
  const setSnapshot = useLab((s) => s.setSnapshot);
  const setNotice = useLab((s) => s.setNotice);
  const lastNotice = useRef<string | null>(null);
  const audioAcc = useRef(0);
  const prevPower = useRef(false);
  const { invalidate } = useThree();

  // 音频开关即时生效
  useEffect(() => {
    audioEngine.setEnabled(soundOn);
    if (!soundOn) audioEngine.stopAlarm();
  }, [soundOn]);

  useEffect(() => {
    return () => audioEngine.stopAlarm();
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.06);
    const speed = sim.cfg.speed;

    // 1. 推进模拟内核
    if (!paused) sim.advance(dt, speed);

    // 2. 事件 -> 粒子 + 部件脉冲 + 音频
    const events = sim.drainEvents();
    flow.handleEvents(
      events,
      { explode: useLab.getState().explode, framesTotal: sim.cfg.frames, view: viewMode, reduced },
      performance.now()
    );
    if (!paused) flow.step(dt);
    else flow.step(dt * 0.15); // 暂停时粒子慢速滑行

    // 3. 音频事件(节流)
    if (soundOn && events.length > 0) {
      for (const ev of events) {
        const kind = FlowSystem.audioRelevant(ev);
        if (!kind) continue;
        switch (kind) {
          case 'procLoad':
            audioEngine.procLoad();
            break;
          case 'tick':
            audioEngine.pipelineTick(0);
            break;
          case 'cacheHit':
            audioEngine.cacheHit(ev.level ?? 'l1d');
            break;
          case 'cacheMiss':
            audioEngine.cacheMiss();
            break;
          case 'pageFault':
            audioEngine.pageFault();
            break;
          case 'ctxSwitch':
            audioEngine.ctxSwitch();
            break;
          case 'interrupt':
            audioEngine.interrupt();
            break;
          case 'diskIO':
            audioEngine.diskIO();
            break;
          case 'bootBeep':
            audioEngine.bootBeep();
            break;
          case 'shutdownGlide':
            audioEngine.shutdownGlide();
            break;
          default:
            break;
        }
      }
      audioAcc.current += dt;
      if (audioAcc.current > 0.25) {
        audioAcc.current = 0;
        audioEngine.update({
          power: sim.power,
          util: sim.metrics.cpuUtil,
          temp: sim.temp,
          freq: sim.freq,
          fan: Math.min(1, (sim.temp - 24) / 30),
          alarm: sim.deadlockFlag
        });
      }
    }

    // 4. 停机完成提示
    if (prevPower.current && !sim.power) {
      setNotice('notice_poweroff');
      window.setTimeout(() => {
        if (useLab.getState().notice === 'notice_poweroff') setNotice(null);
      }, 2500);
    }
    prevPower.current = sim.power;

    // 5. 快照发布(约 8 次/秒,UI 平滑联动)
    if (sim.cycle % 8 === 0 || events.length > 0) {
      setSnapshot(sim.snapshot());
    }
    invalidate();
  });

  void CYCLES_PER_SEC;
  void setNotice;
  void lastNotice;
  return null;
}
