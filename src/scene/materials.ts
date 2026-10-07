// 共享材质与配色:近黑 / 骨白 / 钛灰 / 黄铜 / 冷蓝 / 暖橙
import * as THREE from 'three';

export const COLORS = {
  bg: '#07080a',
  board: '#101318',
  boardEdge: '#1a1e24',
  bone: '#e8e4d8',
  dim: '#8a8f98',
  line: '#262b33',
  titanium: '#8a8f98',
  titaniumDark: '#4a4e55',
  brass: '#b08d3e',
  cold: '#4fa3d9',
  coldDim: '#1c4a6e',
  warm: '#e08a3c',
  warmDim: '#6e4420',
  alarm: '#d94f3a',
  green: '#5aa88f'
};

export function metal(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.55,
    ...opts
  });
}

export function flat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.15,
    roughness: 0.85,
    ...opts
  });
}

/** 发光材质(部件活动脉冲由组件调 emissiveIntensity) */
export function glow(base: string, emissive: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: base,
    metalness: 0.4,
    roughness: 0.5,
    emissive: new THREE.Color(emissive),
    emissiveIntensity: 0
  });
}
