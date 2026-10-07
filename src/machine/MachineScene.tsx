// 场景根:装配所有硬件部件、剖切裁剪、连续爆炸动画
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLab, SAFE_EXPLODE } from '../state/store';
import { sim } from '../kernel/sim';
import { CpuAssembly } from './CpuAssembly';
import { ControlAssembly, DiskAssembly, MemoryAssembly } from './MemoryDisk';
import { BoardAssembly, KernelAssembly } from './KernelBoard';
import { Particles } from './Particles';
import { FlowDriver } from './FlowDriver';
import { setBusActive } from './Widgets';
import { partActivity } from '../flow/paths';

/** 剖切辅助:按 section 值给材质加 clippingPlanes */
function useSectionClip(section: number) {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  useEffect(() => {
    // section 0..1 -> 从前沿(z=14)切到后沿(z=-14)
    plane.constant = 14 - section * 28;
  }, [section, plane]);
  return plane;
}

export function MachineScene() {
  const explode = useLab((s) => s.explode);
  const autoExplode = useLab((s) => s.autoExplode);
  const setExplode = useLab((s) => s.setExplode);
  const section = useLab((s) => s.section);
  const layerAlpha = useLab((s) => s.layerAlpha);
  const setNotice = useLab((s) => s.setNotice);
  const noticeTimer = useRef<number>(0);
  const suspendedNoticeShown = useRef(false);

  useSectionClip(section);

  // 连续爆炸拆解动画:0 -> 1 往返
  useFrame((_, dt) => {
    if (!autoExplode) return;
    const dir = (Math.floor(performance.now() / 9000) % 2) === 0 ? 1 : -1;
    const next = Math.max(0, Math.min(1, explode + dir * dt * 0.12));
    setExplode(next);
  });

  // 拆解超限提示(只提示一次)
  useEffect(() => {
    if (explode > SAFE_EXPLODE && !suspendedNoticeShown.current) {
      suspendedNoticeShown.current = true;
      setNotice('notice_explode_suspended');
      noticeTimer.current = window.setTimeout(() => {
        if (useLab.getState().notice === 'notice_explode_suspended') setNotice(null);
      }, 3200);
    } else if (explode <= SAFE_EXPLODE) {
      suspendedNoticeShown.current = false;
    }
  }, [explode, setNotice]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      setBusActive(false);
    };
  }, []);

  void sim;
  void partActivity;

  return (
    <group>
      <FlowDriver />
      <BoardAssembly layerAlpha={layerAlpha.board} section={section} />
      <CpuAssembly explode={explode} layerAlpha={layerAlpha.cpuLid} />
      <MemoryAssembly explode={explode} layerAlpha={layerAlpha.memShell} />
      <DiskAssembly explode={explode} layerAlpha={layerAlpha.diskShell} />
      <ControlAssembly explode={explode} />
      <KernelAssembly explode={explode} />
      <Particles />
    </group>
  );
}
