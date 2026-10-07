// 粒子渲染:InstancedMesh 池化渲染四种粒子
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../scene/materials';
import { flow } from '../flow';
import { useLab } from '../state/store';
import { setBusActive } from './Widgets';

const KIND_COLOR: Record<string, THREE.Color> = {
  data: new THREE.Color(COLORS.cold),
  instr: new THREE.Color('#9fd9f2'),
  ctrl: new THREE.Color(COLORS.warm),
  writeback: new THREE.Color(COLORS.alarm)
};

const dummy = new THREE.Object3D();

export function Particles({ count = 320 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const viewMode = useLab((s) => s.viewMode);
  const heatMode = viewMode === 'heat';

  const geo = useMemo(() => new THREE.BoxGeometry(0.16, 0.16, 0.3), []);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: '#ffffff',
        emissiveIntensity: 1.6,
        metalness: 0.2,
        roughness: 0.4
      }),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const ps = flow.pool.particles;
    let n = 0;
    let anyMoving = false;
    for (const p of ps) {
      if (!p.active) continue;
      anyMoving = true;
      dummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
      // 朝向运动方向
      const a = p.seg * 3;
      const dx = p.path[a + 3] - p.path[a];
      const dy = p.path[a + 4] - p.path[a + 1];
      const dz = p.path[a + 5] - p.path[a + 2];
      dummy.lookAt(p.pos[0] + dx, p.pos[1] + dy, p.pos[2] + dz);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      mesh.setColorAt(n, KIND_COLOR[p.kind] ?? KIND_COLOR.data);
      n++;
      if (n >= count) break;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    setBusActive(anyMoving && !heatMode);
  });

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, count]} frustumCulled={false}>
      {null}
    </instancedMesh>
  );
}
