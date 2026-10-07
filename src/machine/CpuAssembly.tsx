// CPU 封装:五级流水线 / 寄存器堆 / PC / 中断引脚 / MMU+TLB
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../scene/materials';
import { useLab } from '../state/store';
import { anchor, PART_POS } from './parts';
import { IndicatorCell, Nameplate, PartBox } from './Widgets';
import { sim } from '../kernel/sim';
import { partActivity } from '../flow/paths';

/** 流水线段:活跃时冷蓝脉冲,含阶段铭牌 */
function PipeStage({
  stage,
  x,
  explode,
  active
}: {
  stage: 'if' | 'id' | 'ex' | 'mem' | 'wb';
  x: number;
  explode: number;
  active: boolean;
}) {
  const key = `cpu_${stage}`;
  const p = anchor(key, explode);
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  const act = useRef(0);
  useFrame(() => {
    const a = partActivity('cpu', performance.now()) * 0.5 + (active ? 0.9 : 0);
    act.current += (Math.min(1, a) - act.current) * 0.3;
    if (ref.current) ref.current.emissiveIntensity = act.current * 1.5;
  });
  return (
    <group position={[p[0], p[1] + 0.55, p[2]]}>
      <mesh>
        <boxGeometry args={[1.0, 0.5, 0.8]} />
        <meshStandardMaterial
          ref={ref}
          color={active ? '#2a3540' : '#1c2026'}
          metalness={0.5}
          roughness={0.5}
          emissive={COLORS.cold}
          emissiveIntensity={0}
        />
      </mesh>
      <Nameplate text={stage.toUpperCase()} y={0.48} />
      <IndicatorCell position={[0, 0.3, 0]} active={active} color={COLORS.cold} size={0.14} />
      {void x}
    </group>
  );
}

/** 寄存器堆:8 个指示单元,值非零点亮 */
function RegisterFile({ explode }: { explode: number }) {
  const p = anchor('cpu_regs', explode);
  const regsRef = useRef<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
  useFrame(() => {
    const snap = sim.regs;
    for (let i = 0; i < 8; i++) regsRef.current[i] = snap[i];
  });
  return (
    <group position={[p[0], p[1] + 0.5, p[2]]}>
      {regsRef.current.map((v, i) => (
        <IndicatorCell
          key={i}
          position={[(i - 3.5) * 0.3, 0, 0]}
          active={v !== 0}
          color={COLORS.bone}
          size={0.2}
        />
      ))}
    </group>
  );
}

export function CpuAssembly({ explode, layerAlpha }: { explode: number; layerAlpha: number }) {
  const cpu = anchor('cpu', explode);
  const tlb = anchor('tlb', explode);
  const l1i = anchor('l1i', explode);
  const l1d = anchor('l1d', explode);
  const l2 = anchor('l2', explode);
  const l3 = anchor('l3', explode);
  const pc = anchor('cpu_pc', explode);
  const snap = useLab((s) => s.snapshot);
  const selectPart = useLab((s) => s.selectPart);
  const selected = useLab((s) => s.selectedPart);
  void selectPart;

  const pipeActive = (stage: string) => {
    if (!snap) return false;
    const st = snap.pipeline.find((s) => s.key === stage);
    return st ? st.active : false;
  };

  return (
    <group>
      {/* CPU 封装基座(剖切时可半透明露出内部) */}
      <PartBox
        id="cpu"
        position={[cpu[0], cpu[1], cpu[2]]}
        size={[6.4, 1.1, 4.6]}
        label="part_cpu"
        baseColor="#23262c"
        emissive={COLORS.cold}
        glowLevel={partActivity('cpu', performance.now())}
        opacity={layerAlpha}
      />
      {/* 流水线五段 */}
      <PipeStage stage="if" x={0} explode={explode} active={pipeActive('if')} />
      <PipeStage stage="id" x={1} explode={explode} active={pipeActive('id')} />
      <PipeStage stage="ex" x={2} explode={explode} active={pipeActive('ex')} />
      <PipeStage stage="mem" x={3} explode={explode} active={pipeActive('mem')} />
      <PipeStage stage="wb" x={4} explode={explode} active={pipeActive('wb')} />
      {/* 寄存器堆与 PC */}
      <RegisterFile explode={explode} />
      <group position={[pc[0], pc[1] + 0.5, pc[2]]}>
        <IndicatorCell position={[0, 0, 0]} active={!!snap?.power} color={COLORS.brass} size={0.26} />
        <Nameplate text={`PC ${snap?.pc ?? 0}`} y={0.4} />
      </group>
      {/* MMU + TLB */}
      <PartBox
        id="tlb"
        position={[tlb[0], tlb[1] + 0.2, tlb[2]]}
        size={[1.5, 0.6, 1.4]}
        label="part_tlb"
        baseColor="#2a2417"
        emissive={COLORS.brass}
        glowLevel={partActivity('tlb', performance.now())}
      />
      {/* L1I / L1D / L2 / L3 缓存芯片 */}
      <PartBox
        id="l1i"
        position={[l1i[0], l1i[1], l1i[2]]}
        size={[1.15, 0.45, 2.6]}
        label="part_l1i"
        baseColor="#1e2830"
        emissive={COLORS.cold}
        glowLevel={partActivity('l1i', performance.now())}
      />
      <PartBox
        id="l1d"
        position={[l1d[0], l1d[1], l1d[2]]}
        size={[1.15, 0.45, 2.6]}
        label="part_l1d"
        baseColor="#1e2830"
        emissive={COLORS.cold}
        glowLevel={partActivity('l1d', performance.now())}
      />
      <PartBox
        id="l2"
        position={[l2[0], l2[1], l2[2]]}
        size={[1.15, 0.45, 2.6]}
        label="part_l2"
        baseColor="#20262e"
        emissive={COLORS.cold}
        glowLevel={partActivity('l2', performance.now())}
      />
      <PartBox
        id="l3"
        position={[l3[0], l3[1], l3[2]]}
        size={[1.15, 0.45, 2.6]}
        label="part_l3"
        baseColor="#232a30"
        emissive={COLORS.cold}
        glowLevel={partActivity('l3', performance.now())}
      />
      {void PART_POS}
      {void selected}
    </group>
  );
}
