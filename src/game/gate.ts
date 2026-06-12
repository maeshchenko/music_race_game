import * as THREE from 'three';

function textTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.font = 'bold 64px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.fillText(text, 256, 50);
  g.fillText(text, 256, 50); // второй проход — плотнее свечение
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Неоновая арка через дорогу: СТАРТ / ФИНИШ. */
export function makeGate(label: string, color: number, cssColor: string): THREE.Group {
  const gate = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const pillarGeo = new THREE.BoxGeometry(0.35, 5.2, 0.35);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, mat);
    p.position.set(s * 5.4, 2.6, 0);
    gate.add(p);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(11.15, 0.45, 0.35), mat);
  bar.position.set(0, 5.2, 0);
  gate.add(bar);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 1.6),
    new THREE.MeshBasicMaterial({
      map: textTexture(label, cssColor), transparent: true,
      toneMapped: false, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  sign.position.set(0, 4.2, 0.05);
  gate.add(sign);
  return gate;
}
