// 内核区:调度器+就绪队列 / PCB 架 / 中断向量表 / 系统调用门 / 信号量
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../scene/materials';
import { anchor, queueSlot } from './parts';
import { IndicatorCell, PartBox } from './Widgets';
import { sim } from '../kernel/sim';
import { partActivity } from '../flow/paths';

/** 就绪队列:每个就绪进程一个暖橙单元 */
function ReadyQueue({ explode }: { explode: number }) {
  const items = useRef<number[]>([]);
  useFrame(() => {
    items.current = [...sim.readyQueue];
  });
  return (
    <group>
      {items.current.map((pid, i) => {
        const s = queueSlot(Math.min(i, 4), explode);
        return (
          <IndicatorCell
            key={`${pid}:${i}`}
            position={[s[0], s[1] + 0.6, s[2]]}
            active
            color={COLORS.warm}
            size={0.34}
          />
        );
      })}
    </group>
  );
}

export function KernelAssembly({ explode }: { explode: number }) {
  const sched = anchor('sched', explode);
  const pcb = anchor('pcb', explode);
  const ivt = anchor('ivt', explode);
  const sem = anchor('sem', explode);
  const gate = anchor('gate', explode);

  // PCB 架:每个进程一块竖卡,状态着色
  const procs = useRef<
    { pid: number; state: string; x: number }[]
  >([]);
  useFrame(() => {
    procs.current = sim.procs
      .slice(0, 6)
      .map((p, i) => ({ pid: p.pid, state: p.state, x: i }));
  });

  return (
    <group>
      <PartBox
        id="sched"
        position={[sched[0], sched[1], sched[2]]}
        size={[5.2, 0.8, 2.2]}
        label="part_sched"
        baseColor="#2a1f12"
        emissive={COLORS.warm}
        glowLevel={partActivity('sched', performance.now())}
      />
      <ReadyQueue explode={explode} />

      {/* PCB 架 */}
      <PartBox
        id="pcb"
        position={[pcb[0], pcb[1], pcb[2]]}
        size={[5.6, 2.8, 2.0]}
        label="part_pcb"
        baseColor="#211c14"
        emissive={COLORS.warm}
        glowLevel={partActivity('pcb', performance.now())}
      >
        {procs.current.map((p) => {
          const color =
            p.state === 'running'
              ? COLORS.warm
              : p.state === 'ready'
                ? COLORS.brass
                : p.state === 'blocked'
                  ? COLORS.cold
                  : COLORS.titaniumDark;
          return (
            <IndicatorCell
              key={p.pid}
              position={[(p.x - 2.5) * 0.9, 0.6, 0]}
              active={p.state !== 'terminated'}
              color={color}
              size={0.5}
            />
          );
        })}
      </PartBox>

      {/* 中断向量表 */}
      <PartBox
        id="ivt"
        position={[ivt[0], ivt[1], ivt[2]]}
        size={[2.6, 0.7, 1.8]}
        label="part_ivt"
        baseColor="#231d15"
        emissive={COLORS.warm}
        glowLevel={partActivity('ivt', performance.now())}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <IndicatorCell
            key={i}
            position={[(i - 1.5) * 0.5, 0.42, 0]}
            active={sim.power}
            color={COLORS.warm}
            size={0.24}
          />
        ))}
      </PartBox>

      {/* 系统调用门:暖光门柱 */}
      <PartBox
        id="gate"
        position={[gate[0], gate[1], gate[2]]}
        size={[1.2, 2.6, 0.9]}
        label="part_gate"
        baseColor="#2b1e0e"
        emissive={COLORS.warm}
        glowLevel={partActivity('gate', performance.now()) * 0.8 + (sim.cpuMode === 'kernel' ? 0.35 : 0)}
      />

      {/* 信号量 */}
      <PartBox
        id="sem"
        position={[sem[0], sem[1], sem[2]]}
        size={[3.0, 0.7, 1.5]}
        label="part_sem"
        baseColor="#201a10"
        emissive={COLORS.brass}
        glowLevel={partActivity('sem', performance.now())}
      >
        {sim.sems.map((s, i) => (
          <IndicatorCell
            key={s.id}
            position={[(i - 0.5) * 0.8, 0.42, 0]}
            active={s.value === 1}
            color={COLORS.green}
            size={0.3}
          />
        ))}
      </PartBox>
    </group>
  );
}

/** 主板与总线:所有部件的基板 */
export function BoardAssembly({ layerAlpha, section }: { layerAlpha: number; section: number }) {
  const busRef = useRef<THREE.Mesh>(null);
  const show = section < 0 ? 1 : Math.max(0.04, 1 - section);
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[44, 0.4, 28]} />
        <meshStandardMaterial
          color={COLORS.board}
          metalness={0.35}
          roughness={0.7}
          transparent={layerAlpha < 1 || section >= 0}
          opacity={layerAlpha * show}
        />
      </mesh>
      {/* 主板边框细线 */}
      <lineSegments position={[0, 0.42, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(44, 0.4, 28)]} />
        <lineBasicMaterial color={COLORS.brass} transparent opacity={0.35} />
      </lineSegments>
      {/* 布线层(剖切时显露) */}
      {section >= 0 && (
        <group position={[0, 0.12, 0]}>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[-16 + i * 5.4, 0, 0]}>
              <boxGeometry args={[0.12, 0.04, 26]} />
              <meshStandardMaterial color="#3d2f14" metalness={0.7} roughness={0.35} emissive={COLORS.brass} emissiveIntensity={0.12} />
            </mesh>
          ))}
        </group>
      )}
      {void busRef}
    </group>
  );
}
