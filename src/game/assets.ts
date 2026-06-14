import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Загрузка внешних 3D-моделей (CC0/CC-BY с Poly Pizza) — НЕ лепим руками.
 *  • arch.glb — Arch Round, Quaternius (CC0) → шаблон ворот акцентов (МЕГА-ноты).
 * Масса нот — нейтральный скруглённый куб (примитив в blocks.ts, Audiosurf-стиль):
 * для простой инстанс-формы примитив правильнее модели (см. память про модели).
 * Грузим один раз до создания Game/Blocks; кэшируем масштаб/сдвиг.
 */

let archTemplate: THREE.Object3D | null = null;
let archScale = 1; // множитель, чтобы ширина арки ≈ ARCH_WIDTH
let archBaseY = 0; // сдвиг по Y (после scale), чтобы низ арки сел на дорогу
let loading: Promise<void> | null = null;

const ARCH_WIDTH = 3.2; // целевая ширина ворот (≈ полоса+зазор)

export function loadAssets(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const loader = new GLTFLoader();
    const arch = await loader.loadAsync('models/arch.glb');
    // арка: считаем масштаб под ширину полосы и сдвиг низа на дорогу (узел уже
    // несёт scale×100 +поворот стоя). Шаблон клонируем/перекрашиваем при размещении.
    arch.scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(arch.scene);
    const w = Math.max(1e-3, box.max.x - box.min.x);
    archScale = ARCH_WIDTH / w;
    archBaseY = -box.min.y * archScale; // низ арки → y=0 после масштабирования
    archTemplate = arch.scene;
  })();
  return loading;
}

/** Шаблон арки (клонировать для ворот) или null. */
export const getArchTemplate = (): THREE.Object3D | null => archTemplate;
/** Множитель масштаба арки (ширина ≈ полоса). */
export const getArchScale = (): number => archScale;
/** Сдвиг по Y, чтобы низ арки сел на дорогу (после scale). */
export const getArchBaseY = (): number => archBaseY;
