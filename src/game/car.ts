import * as THREE from 'three';

/**
 * Низкополигональная «семёрка» (ВАЗ-2107) из примитивов: угловатая кабина,
 * хром-бамперы, прямоугольная решётка и фары. ~4.1 × 1.6 м.
 * lightsOn: false — припаркованная (фары и фонари потушены, без прожектора).
 */
export function buildCar(opts: { color?: number; lightsOn?: boolean } = {}): THREE.Group {
  const { color = 0x6b1220, lightsOn = true } = opts;
  const car = new THREE.Group();

  const cherry = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.15, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.25, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95 });
  const headlight = lightsOn
    ? new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe9b0, emissiveIntensity: 2.2 })
    : new THREE.MeshStandardMaterial({ color: 0x8d8c80, roughness: 0.3, metalness: 0.4 });
  const taillight = lightsOn
    ? new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.6 })
    : new THREE.MeshStandardMaterial({ color: 0x4a1015, roughness: 0.4 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    car.add(m);
    return m;
  };

  // нижний кузов (нос — в -z)
  add(new THREE.BoxGeometry(1.62, 0.52, 4.1), cherry, 0, 0.52, 0);
  // капот и багажник чуть ниже крыши кабины — кабина отдельным объёмом
  add(new THREE.BoxGeometry(1.5, 0.42, 1.7), glass, 0, 0.98, 0.15); // остекление
  add(new THREE.BoxGeometry(1.54, 0.06, 1.8), cherry, 0, 1.22, 0.15); // крыша
  // стойки по углам кабины
  const pillarGeo = new THREE.BoxGeometry(0.07, 0.46, 0.07);
  for (const [px, pz] of [[-0.72, -0.68], [0.72, -0.68], [-0.72, 0.98], [0.72, 0.98]])
    add(pillarGeo, cherry, px, 0.98, pz + 0.15);

  // бамперы
  add(new THREE.BoxGeometry(1.7, 0.14, 0.18), chrome, 0, 0.38, -2.1);
  add(new THREE.BoxGeometry(1.7, 0.14, 0.18), chrome, 0, 0.38, 2.1);
  // решётка радиатора
  add(new THREE.BoxGeometry(0.7, 0.18, 0.05), chrome, 0, 0.62, -2.06);
  // фары и задние фонари
  add(new THREE.BoxGeometry(0.34, 0.16, 0.05), headlight, -0.55, 0.62, -2.06);
  add(new THREE.BoxGeometry(0.34, 0.16, 0.05), headlight, 0.55, 0.62, -2.06);
  add(new THREE.BoxGeometry(0.4, 0.14, 0.05), taillight, -0.52, 0.6, 2.06);
  add(new THREE.BoxGeometry(0.4, 0.14, 0.05), taillight, 0.52, 0.6, 2.06);

  // колёса
  const wheelGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-0.78, -1.32], [0.78, -1.32], [-0.78, 1.32], [0.78, 1.32]])
    add(wheelGeo, rubber, wx, 0.31, wz);

  if (lightsOn) {
    // свет фар — тёплое пятно перед машиной
    const beam = new THREE.SpotLight(0xffe5b0, 60, 30, 0.5, 0.6, 1.6);
    beam.position.set(0, 0.7, -1.9);
    beam.target.position.set(0, 0, -14);
    car.add(beam, beam.target);
  }

  return car;
}
