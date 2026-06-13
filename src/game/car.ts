import * as THREE from 'three';

/**
 * Текстура линзы задней фары ВАЗ-2107: ночью светится мягким тёплым красным,
 * секции едва читаются (оранжевый поворотник слева, белый задний-ход справа
 * лишь намёком). Размыта — фара в «тумане», не резкая. Идёт в emissiveMap.
 */
function taillightTexture(): THREE.CanvasTexture {
  const W = 64, H = 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a0402'; g.fillRect(0, 0, W, H);
  g.filter = 'blur(2.5px)'; // размытие линзы — мягкое свечение, не резко
  // основное тёплое красное тело лампы
  const body = g.createRadialGradient(32, 17, 2, 32, 20, 33);
  body.addColorStop(0, '#ff8a4a');
  body.addColorStop(0.4, '#ff3016');
  body.addColorStop(0.8, '#c0140a');
  body.addColorStop(1, '#2c0604');
  g.fillStyle = body; g.fillRect(0, 0, W, H);
  // намёк оранжевого (поворотник) слева-внизу
  const amber = g.createRadialGradient(13, 30, 1, 13, 30, 15);
  amber.addColorStop(0, 'rgba(255,165,60,0.55)');
  amber.addColorStop(1, 'rgba(255,165,60,0)');
  g.fillStyle = amber; g.fillRect(0, 18, 30, 22);
  // намёк холодного (задний ход) справа-внизу
  const cool = g.createRadialGradient(52, 30, 1, 52, 30, 14);
  cool.addColorStop(0, 'rgba(230,235,240,0.4)');
  cool.addColorStop(1, 'rgba(230,235,240,0)');
  g.fillStyle = cool; g.fillRect(34, 18, 30, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Передняя фара ВАЗ-2107: белый прямоугольный основной свет + оранжевый
 * поворотник у внешнего края, рифлёная линза. Размыта — мягкое свечение.
 * Амбер слева (для левой фары — наружу); правая берёт зеркальную копию.
 */
function headlightTexture(): THREE.CanvasTexture {
  const W = 64, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0a0d'; g.fillRect(0, 0, W, H);
  g.filter = 'blur(1.8px)';
  // основной белый свет (правые ~78%)
  const main = g.createRadialGradient(40, 15, 2, 40, 17, 30);
  main.addColorStop(0, '#ffffff');
  main.addColorStop(0.45, '#eef2ff');
  main.addColorStop(0.85, '#9aa6c0');
  main.addColorStop(1, '#2a3040');
  g.fillStyle = main; g.fillRect(14, 1, W - 15, H - 2);
  // оранжевый поворотник слева (наружный край)
  const amber = g.createRadialGradient(8, 16, 1, 8, 16, 12);
  amber.addColorStop(0, '#ffb83a');
  amber.addColorStop(0.7, '#d07810');
  amber.addColorStop(1, '#3a2208');
  g.fillStyle = amber; g.fillRect(1, 1, 12, H - 2);
  // рифление линзы
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 0; x < W; x += 3) g.fillRect(x, 0, 1, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Мягкий радиальный ореол для glow-спрайта фары (аддитивно, ловится bloom). */
function tailGlowTexture(): THREE.CanvasTexture {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  // мягко, без бело-горячего центра — тёплый красный, плавный спад
  rg.addColorStop(0, 'rgba(255,150,95,0.6)');
  rg.addColorStop(0.3, 'rgba(255,70,40,0.34)');
  rg.addColorStop(0.65, 'rgba(220,32,18,0.14)');
  rg.addColorStop(1, 'rgba(210,28,16,0)');
  g.fillStyle = rg; g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Мягкий белый ореол для фары (передний свет «в тумане»). */
function headGlowTexture(): THREE.CanvasTexture {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(255,255,255,0.7)');
  rg.addColorStop(0.3, 'rgba(230,238,255,0.36)');
  rg.addColorStop(0.65, 'rgba(180,200,240,0.13)');
  rg.addColorStop(1, 'rgba(170,195,240,0)');
  g.fillStyle = rg; g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Низкополигональная «семёрка» (ВАЗ-2107) из примитивов: угловатая кабина,
 * хром-бамперы, прямоугольная решётка и фары. ~4.1 × 1.6 м.
 * lightsOn: false — припаркованная (фары и фонари потушены, без прожектора).
 */
export function buildCar(opts: { color?: number; lightsOn?: boolean; beam?: boolean } = {}): THREE.Group {
  const { color = 0x6b1220, lightsOn = true, beam = lightsOn } = opts;
  const car = new THREE.Group();

  const cherry = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.15, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.25, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95 });
  // передняя фара: текстурная линза (белый свет + оранжевый поворотник).
  // правая — зеркальная копия (поворотник наружу с обеих сторон)
  const headTexL = lightsOn ? headlightTexture() : null;
  const headTexR = headTexL ? (() => {
    const t = headTexL.clone();
    t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1;
    t.needsUpdate = true; return t;
  })() : null;
  const headMat = (tex: THREE.CanvasTexture | null) => lightsOn
    ? new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff,
        emissiveIntensity: 2.4, toneMapped: false,
      })
    : new THREE.MeshStandardMaterial({ color: 0x8d8c80, roughness: 0.3, metalness: 0.4 });
  const headlightL = headMat(headTexL);
  const headlightR = headMat(headTexR);
  // задняя фара: текстурная линза ВАЗ-2107, светится узором. Тусклый ночной
  // габарит по умолчанию (intensity ~0.9), Game поднимает при торможении.
  const tailTex = lightsOn ? taillightTexture() : null;
  const taillight = lightsOn
    ? new THREE.MeshStandardMaterial({
        map: tailTex, emissiveMap: tailTex, emissive: 0xffffff,
        emissiveIntensity: 0.9, toneMapped: false,
      })
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
  add(new THREE.BoxGeometry(0.42, 0.18, 0.05), headlightL, -0.55, 0.62, -2.06);
  add(new THREE.BoxGeometry(0.42, 0.18, 0.05), headlightR, 0.55, 0.62, -2.06);
  // белый ореол передних фар — мягкое свечение «в тумане». depthTest:true,
  // чтобы у своей машины кузов прятал ореол сзади, а у встречных — виден
  if (lightsOn) {
    const hg = headGlowTexture();
    for (const sx of [-0.55, 0.55]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: hg, color: 0xfff0e0, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      spr.position.set(sx, 0.62, -2.14);
      spr.scale.set(1.1, 0.8, 1);
      car.add(spr);
    }
  }
  // линза-бокс поменьше — тёмный корпус не выпирает «полоской» из-под свечения
  add(new THREE.BoxGeometry(0.36, 0.13, 0.04), taillight, -0.52, 0.62, 2.07).name = 'taillight';
  add(new THREE.BoxGeometry(0.36, 0.13, 0.04), taillight, 0.52, 0.62, 2.07).name = 'taillight';
  // мягкий ореол свечения — фара «в тумане», аддитивно, ловится bloom.
  // depthTest:false — бампер на поворотах не протыкает ореол
  if (lightsOn) {
    const glowTex = tailGlowTexture();
    for (const sx of [-0.52, 0.52]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xff4424, transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        toneMapped: false,
      }));
      spr.position.set(sx, 0.62, 2.18);
      spr.scale.set(1.15, 0.85, 1);
      spr.name = 'tailglow';
      car.add(spr);
    }
  }

  // колёса
  const wheelGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[-0.78, -1.32], [0.78, -1.32], [-0.78, 1.32], [0.78, 1.32]])
    add(wheelGeo, rubber, wx, 0.31, wz);

  if (beam) {
    // свет фар — тёплое пятно перед машиной (только у машины игрока:
    // прожектор на каждую машину трафика дорог для рендера)
    const spot = new THREE.SpotLight(0xffe5b0, 60, 30, 0.5, 0.6, 1.6);
    spot.position.set(0, 0.7, -1.9);
    spot.target.position.set(0, 0, -14);
    car.add(spot, spot.target);
  }

  return car;
}
