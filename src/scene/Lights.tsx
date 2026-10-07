// 灯光:冷色轮廓光表现指令执行与访存数据通路,暖色光表现调度决策与内核态
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sim } from '../kernel/sim';
import { partActivity } from '../flow/paths';

export function Lights() {
  const coldData = useRef<THREE.PointLight>(null);
  const coldMem = useRef<THREE.PointLight>(null);
  const warmKernel = useRef<THREE.PointLight>(null);
  const warmPic = useRef<THREE.PointLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);

  useFrame(() => {
    const now = performance.now();
    const power = sim.power ? 1 : 0;
    // 数据通路活跃度(缓存/内存/总线) → 冷蓝光强
    const dataAct = Math.min(
      1,
      (partActivity('l1d', now) + partActivity('l2', now) + partActivity('l3', now) +
        partActivity('dram', now) + partActivity('bus', now)) * 0.4
    );
    // 控制通路(调度/中断/系统调用) → 暖橙光强
    const ctrlAct = Math.min(
      1,
      (partActivity('sched', now) + partActivity('pic', now) + partActivity('gate', now) +
        partActivity('ivt', now)) * 0.5
    );
    const freq = sim.freq;
    if (coldData.current) coldData.current.intensity = power * (10 + dataAct * 55 + freq * 14);
    if (coldMem.current) coldMem.current.intensity = power * (6 + dataAct * 26);
    if (warmKernel.current) warmKernel.current.intensity = power * (8 + ctrlAct * 46);
    if (warmPic.current) warmPic.current.intensity = power * (4 + ctrlAct * 22);
    if (ambient.current) ambient.current.intensity = 0.34 + power * 0.18;
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.34} color="#cfd6de" />
      <directionalLight position={[14, 26, 18]} intensity={0.85} color="#e8e4d8" />
      <directionalLight position={[-20, 14, -12]} intensity={0.28} color="#4fa3d9" />
      {/* 冷蓝:CPU 与总线数据通路 */}
      <pointLight ref={coldData} position={[-6, 7, 0]} color="#4fa3d9" intensity={0} distance={30} decay={1.6} />
      {/* 冷蓝:内存 */}
      <pointLight ref={coldMem} position={[5, 6, -7]} color="#2e6f9e" intensity={0} distance={22} decay={1.6} />
      {/* 暖橙:内核区(调度器/PCB/门) */}
      <pointLight ref={warmKernel} position={[-13, 6.5, -8]} color="#e08a3c" intensity={0} distance={24} decay={1.6} />
      {/* 暖橙:中断控制器 */}
      <pointLight ref={warmPic} position={[-3, 4.5, 3]} color="#e08a3c" intensity={0} distance={12} decay={1.6} />
    </>
  );
}
