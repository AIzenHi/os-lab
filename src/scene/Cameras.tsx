// 相机 rig:五种镜头(全局/指令执行流/访存缺页路径/调度与中断控制/自由检查)
import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useLab } from '../state/store';
import { CAMERA_PRESETS } from '../machine/parts';

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const preset = useLab((s) => s.camera);
  const reduced = useLab((s) => s.reducedMotion);
  const target = useRef(new THREE.Vector3(...CAMERA_PRESETS.global.target));
  const posTarget = useRef(new THREE.Vector3(...CAMERA_PRESETS.global.pos));
  const controls = useRef<any>(null);
  const animating = useRef(false);

  useEffect(() => {
    const p = CAMERA_PRESETS[preset] ?? CAMERA_PRESETS.global;
    if (preset === 'free') {
      animating.current = false;
      return;
    }
    posTarget.current.set(...p.pos);
    target.current.set(...p.target);
    if (reduced) {
      camera.position.set(...p.pos);
      if (controls.current) {
        controls.current.target.set(...p.target);
        controls.current.update();
      } else {
        camera.lookAt(target.current);
      }
    } else {
      animating.current = true;
    }
  }, [preset, camera, reduced]);

  useFrame((_, dt) => {
    if (preset !== 'free' && animating.current) {
      const k = 1 - Math.pow(0.001, dt); // 平滑趋近
      camera.position.lerp(posTarget.current, k);
      const cur = controls.current ? controls.current.target : null;
      if (cur) {
        cur.lerp(target.current, k);
        controls.current.update();
      } else {
        camera.lookAt(target.current);
      }
      if (camera.position.distanceTo(posTarget.current) < 0.05) animating.current = false;
    }
    void gl;
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={preset === 'free'}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.49}
      minDistance={4}
      maxDistance={70}
      target={[0, 0.5, -1]}
      makeDefault
    />
  );
}
