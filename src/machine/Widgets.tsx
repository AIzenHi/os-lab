// 共享 3D 小组件:可点击部件盒 / 机械铭牌 / 发光指示单元 / 缓存矩阵
import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { COLORS, flat, metal } from '../scene/materials';
import { useLab } from '../state/store';
import { useT } from '../i18n';
import type { StringKey } from '../i18n';

/** 可点击部件容器:细边框直角盒体,统一处理选中高亮与点击 */
export function PartBox({
  id,
  position,
  size,
  label,
  children,
  baseColor = COLORS.titaniumDark,
  emissive = '#000000',
  glowLevel = 0,
  opacity = 1,
  onClick
}: {
  id: string;
  position: [number, number, number];
  size: [number, number, number];
  label?: StringKey;
  children?: ReactNode;
  baseColor?: string;
  emissive?: string;
  glowLevel?: number; // 0..1 外部驱动的基础发光(部件热度)
  opacity?: number;
  onClick?: () => void;
}) {
  const selected = useLab((s) => s.selectedPart === id);
  const selectPart = useLab((s) => s.selectPart);
  const showLabels = useLab((s) => s.showLabels);
  const t = useT();
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
    [size[0], size[1], size[2]]
  );

  useFrame(() => {
    if (!mat.current) return;
    const target = selected ? 1.5 : glowLevel * 1.1;
    mat.current.emissiveIntensity +=
      (target - mat.current.emissiveIntensity) * 0.22;
  });

  const handle = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectPart(selected ? null : id);
    onClick?.();
  };

  return (
    <group position={position}>
      <mesh onClick={handle} castShadow={opacity > 0.6}>
        <boxGeometry args={size} />
        <meshStandardMaterial
          ref={mat}
          color={baseColor}
          metalness={0.5}
          roughness={0.55}
          emissive={emissive}
          emissiveIntensity={0}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      {/* 常显细描边(选中时更亮) */}
      <lineSegments geometry={edges} scale={1.001}>
        <lineBasicMaterial
          color={selected ? COLORS.bone : COLORS.titaniumDark}
          transparent
          opacity={selected ? 0.95 : 0.55}
        />
      </lineSegments>
      {showLabels && label && !selected && (
        <Nameplate text={t(label)} y={size[1] / 2 + 0.4} />
      )}
      {children}
    </group>
  );
}

/** 机械铭牌:细边框直角标牌 */
export function Nameplate({ text, y, z = 0 }: { text: string; y: number; z?: number }) {
  const w = Math.max(1.4, text.length * 0.26 + 0.3);
  const geo = useMemo(() => new THREE.PlaneGeometry(w, 0.46), [w]);
  const edge = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  return (
    <group position={[0, y, z]}>
      <mesh geometry={geo} renderOrder={2}>
        <meshBasicMaterial color="#0b0d11" transparent opacity={0.94} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edge} renderOrder={3}>
        <lineBasicMaterial color={COLORS.brass} transparent opacity={0.85} depthWrite={false} />
      </lineSegments>
      <Text
        fontSize={0.22}
        color={COLORS.bone}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.16}
        renderOrder={4}
        material={flat('#e8e4d8')}
        position={[0, 0, 0.01]}
      >
        {text}
      </Text>
    </group>
  );
}

/** 状态指示单元:小方块,active 时发光 */
export function IndicatorCell({
  position,
  active,
  color,
  size = 0.16
}: {
  position: [number, number, number];
  active: boolean;
  color: string;
  size?: number;
}) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!ref.current) return;
    const target = active ? 1.3 : 0;
    ref.current.emissiveIntensity += (target - ref.current.emissiveIntensity) * 0.3;
  });
  return (
    <mesh position={position}>
      <boxGeometry args={[size, size * 0.55, size]} />
      <meshStandardMaterial
        ref={ref}
        color={active ? color : '#22262c'}
        emissive={color}
        emissiveIntensity={0}
        metalness={0.35}
        roughness={0.45}
      />
    </mesh>
  );
}

/** 缓存矩阵:occupancy 决定点亮比例(贴在部件顶面) */
export function CacheGrid({
  position,
  cols,
  rows,
  fill,
  color
}: {
  position: [number, number, number];
  cols: number;
  rows: number;
  fill: number;
  color: string;
}) {
  const total = cols * rows;
  const lit = Math.round(fill * total);
  const stepX = 0.34;
  const stepZ = 0.34;
  return (
    <group position={position}>
      {Array.from({ length: total }, (_, i) => (
        <IndicatorCell
          key={i}
          position={[
            (i % cols - (cols - 1) / 2) * stepX,
            0,
            (Math.floor(i / cols) - (rows - 1) / 2) * stepZ
          ]}
          active={i < lit}
          color={color}
          size={0.2}
        />
      ))}
    </group>
  );
}

/** 总线轨道:主板上的三条并行走线,活动时中间一条泛冷蓝 */
export function BusTrack({ length }: { length: number }) {
  const mid = useRef<THREE.MeshStandardMaterial>(null);
  const heat = useRef(0);
  useFrame((_, dt) => {
    const on = globalThis.__oslabBusActive ? 1 : 0;
    heat.current += (on - heat.current) * Math.min(1, dt * 5);
    if (mid.current) mid.current.emissiveIntensity = heat.current * 0.9;
  });
  return (
    <group position={[0, 0.55, 0]}>
      <mesh position={[0, 0, -0.3]} material={metal('#24282e')}>
        <boxGeometry args={[length, 0.07, 0.16]} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[length, 0.07, 0.16]} />
        <meshStandardMaterial
          ref={mid}
          color="#31363d"
          metalness={0.65}
          roughness={0.4}
          emissive={COLORS.cold}
          emissiveIntensity={0}
        />
      </mesh>
      <mesh position={[0, 0, 0.3]} material={metal('#24282e')}>
        <boxGeometry args={[length, 0.07, 0.16]} />
      </mesh>
    </group>
  );
}

/** 供 BusTrack 读取的总线活动标志(由 FlowDriver 设置) */
declare global {
  // eslint-disable-next-line no-var
  var __oslabBusActive: boolean | undefined;
}
export function setBusActive(v: boolean): void {
  globalThis.__oslabBusActive = v;
}
