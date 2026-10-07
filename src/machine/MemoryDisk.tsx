// 内存 DIMM(页框网格)/ 磁盘(块网格 + inode 指示)/ I/O 控制器 / 中断与时钟 / 电源
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../scene/materials';
import { anchor, blockAnchor, frameAnchor } from './parts';
import { IndicatorCell, Nameplate, PartBox } from './Widgets';
import { t } from '../i18n';
import { sim } from '../kernel/sim';
import { partActivity } from '../flow/paths';

/** 内存条:页框网格按状态着色(空闲/内核/进程/脏) */
function Dimm({
  which,
  explode,
  framesTotal,
  layerAlpha,
  label
}: {
  which: 0 | 1;
  explode: number;
  framesTotal: number;
  layerAlpha: number;
  label?: string;
}) {
  const base = which === 0 ? anchor('dram', explode) : anchor('dram2', explode);
  const perDimm = Math.max(1, Math.ceil(framesTotal / 2));
  const show = Math.min(perDimm, which === 0 ? perDimm : framesTotal - perDimm);
  const cols = 4;
  const rows = Math.max(1, Math.ceil(perDimm / cols));
  const ref = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (!ref.current) return;
    const a = partActivity('dram', performance.now());
    ref.current.emissiveIntensity += (a * 1.2 - ref.current.emissiveIntensity) * 0.25;
  });

  return (
    <group position={[base[0], base[1] + 1.6, base[2]]}>
      {/* DIMM 电路板 */}
      <mesh material={undefined}>
        <boxGeometry args={[2.6, 0.5, rows * 0.62 + 1.6]} />
        <meshStandardMaterial
          ref={ref}
          color="#1a2b38"
          metalness={0.4}
          roughness={0.5}
          emissive={COLORS.cold}
          emissiveIntensity={0}
          transparent={layerAlpha < 1}
          opacity={layerAlpha}
        />
      </mesh>
      {label && <Nameplate text={label} y={0.55} />}
      {/* 页框单元格 */}
      {Array.from({ length: Math.max(0, show) }, (_, i) => {
        const pfn = which * perDimm + i;
        const st = sim.frames[pfn] ?? { state: 'free', dirty: false };
        const color =
          st.state === 'kernel'
            ? COLORS.warm
            : st.state === 'user'
              ? st.dirty
                ? COLORS.alarm
                : COLORS.cold
              : '#22262c';
        const row = Math.floor(i / cols);
        const col = i % cols;
        return (
          <IndicatorCell
            key={pfn}
            position={[(col - (cols - 1) / 2) * 0.55, 0.32, (row - (rows - 1) / 2) * 0.62 + 0.3]}
            active={st.state !== 'free'}
            color={color}
            size={0.36}
          />
        );
      })}
    </group>
  );
}

export function MemoryAssembly({
  explode,
  layerAlpha
}: {
  explode: number;
  layerAlpha: number;
}) {
  const framesTotal = sim.cfg.frames;
  return (
    <group>
      <Dimm which={0} explode={explode} framesTotal={framesTotal} layerAlpha={layerAlpha} label={t('part_dram')} />
      <Dimm which={1} explode={explode} framesTotal={framesTotal} layerAlpha={layerAlpha} />
      {/* 二级页表悬浮件 */}
      <PageTableWidget explode={explode} />
    </group>
  );
}

/** 页表指示件:显示最近翻译的 VPN->PFN */
function PageTableWidget({ explode }: { explode: number }) {
  const p = anchor('pt', explode);
  const ref = useRef<THREE.Group>(null);
  const lastTlb = useRef<{ vpn: number; pfn: number }[]>([]);
  useFrame(() => {
    const entries = sim.tlb.entries
      .filter((e) => e.valid)
      .slice(0, 6)
      .map((e) => ({ vpn: e.vpn, pfn: e.pfn }));
    lastTlb.current = entries;
    if (ref.current) ref.current.rotation.y = 0;
  });
  return (
    <group position={[p[0], p[1] + 1.0, p[2]]} ref={ref}>
      <PartBox
        id="pt"
        position={[0, 0, 0]}
        size={[2.2, 1.2, 0.3]}
        label="part_tlb"
        baseColor="#26221a"
        emissive={COLORS.brass}
        glowLevel={partActivity('tlb', performance.now())}
      />
      {lastTlb.current.map((e, i) => (
        <IndicatorCell
          key={`${e.vpn}:${i}`}
          position={[(i - 2.5) * 0.36, 0, 0.2]}
          active
          color={COLORS.brass}
          size={0.22}
        />
      ))}
    </group>
  );
}

/** 磁盘:16×8 块网格,使用中的块亮起 */
export function DiskAssembly({
  explode,
  layerAlpha
}: {
  explode: number;
  layerAlpha: number;
}) {
  const base = anchor('disk', explode);
  const usedRef = useRef<boolean[]>(new Array(128).fill(false));
  const spin = useRef(0);
  useFrame((_, dt) => {
    const fs = sim.fs;
    for (let i = 0; i < 128; i++) usedRef.current[i] = fs.used[i];
    if (sim.dmaActive) spin.current += dt * 3;
  });
  const cols = 16;
  void cols;
  return (
    <group position={[base[0], base[1], base[2]]}>
      <PartBox
        id="disk"
        position={[0, 0, 0]}
        size={[5.4, 0.9, 4.2]}
        label="part_disk"
        baseColor="#20232a"
        emissive={COLORS.brass}
        glowLevel={partActivity('disk', performance.now())}
        opacity={layerAlpha}
      />
      {/* 块网格 */}
      {usedRef.current.slice(0, 128).map((used, b) => {
        const a = blockAnchor(b, 0);
        return (
          <IndicatorCell
            key={b}
            position={[a[0] - base[0], 0.52, a[2] - base[2]]}
            active={used}
            color={COLORS.brass}
            size={0.17}
          />
        );
      })}
      {/* 读写臂 */}
      <group rotation={[0, spin.current, 0]} position={[0, 0.85, 0]}>
        <mesh position={[1.2, 0, 0]} material={undefined}>
          <boxGeometry args={[2.4, 0.06, 0.14]} />
          <meshStandardMaterial color={COLORS.titanium} metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

/** I/O 控制器(DMA)+ 中断控制器 + 时钟 + 电源 */
export function ControlAssembly({ explode }: { explode: number }) {
  const io = anchor('io', explode);
  const pic = anchor('pic', explode);
  const clock = anchor('clock', explode);
  const psu = anchor('psu', explode);
  const blink = useRef(0);
  useFrame((_, dt) => {
    blink.current += dt;
  });
  const clockOn = sim.clockEnabled && Math.floor(blink.current * 2) % 2 === 0;
  return (
    <group>
      <PartBox
        id="io"
        position={[io[0], io[1], io[2]]}
        size={[2.2, 0.7, 1.8]}
        label="part_io"
        baseColor="#1e2420"
        emissive={COLORS.cold}
        glowLevel={partActivity('io', performance.now())}
      />
      <PartBox
        id="pic"
        position={[pic[0], pic[1], pic[2]]}
        size={[2.0, 0.6, 1.5]}
        label="part_pic"
        baseColor="#2a2015"
        emissive={COLORS.warm}
        glowLevel={partActivity('pic', performance.now())}
      >
        {/* 三条中断请求线指示 */}
        <IndicatorCell position={[-0.5, 0.38, 0]} active={sim.pic.timer} color={COLORS.warm} size={0.2} />
        <IndicatorCell position={[0, 0.38, 0]} active={sim.pic.disk} color={COLORS.warm} size={0.2} />
        <IndicatorCell position={[0.5, 0.38, 0]} active={sim.pic.kbd} color={COLORS.warm} size={0.2} />
      </PartBox>
      <PartBox
        id="clock"
        position={[clock[0], clock[1], clock[2]]}
        size={[1.3, 0.5, 1.1]}
        label="part_clock"
        baseColor="#1f1d16"
        emissive={COLORS.brass}
        glowLevel={partActivity('clock', performance.now())}
      >
        <IndicatorCell position={[0, 0.33, 0]} active={clockOn} color={COLORS.brass} size={0.18} />
      </PartBox>
      <PartBox
        id="psu"
        position={[psu[0], psu[1], psu[2]]}
        size={[2.4, 2.6, 2.4]}
        label="part_psu"
        baseColor="#171a20"
        emissive={COLORS.green}
        glowLevel={sim.power ? 0.7 : 0}
      />
    </group>
  );
}

/** 供外部使用:页框锚点导出 */
export { frameAnchor };
