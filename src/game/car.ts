import * as THREE from 'three';

/**
 * Текстура линзы заднего фонаря ВАЗ-2107 — точная раскладка реального блока:
 *   ВЕРХ — 3 красные ячейки (стоп/габарит), в СРЕДНЕЙ — катафот (отражатель,
 *          призматическая сетка);
 *   НИЗ  — 2 ячейки: амбер-поворотник (край) + белый задний-ход (внутрь).
 * Тёмные перегородки между секциями + вертикальные рёбра линзы. Резко (мин. блюр).
 */
function taillightTexture(): THREE.CanvasTexture {
  const W = 96, H = 36;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#180402'; g.fillRect(0, 0, W, H);
  g.filter = 'blur(0.3px)'; // ЧЁТКАЯ линза (сегменты читаются), лишь анти-алиас. Мягкость даёт
  //                            спрайт-ореол вокруг фонаря (outer glow), а не размытие текстуры.
  const mid = 19; // граница верх(красные ячейки)/низ(поворотник+задний ход)
  const inX = 2, inW = W - 4;
  // ВЕРХ: 3 красные ячейки
  const cw3 = inW / 3;
  const redCell = (x: number, w: number) => {
    const r = g.createLinearGradient(0, 0, 0, mid);
    r.addColorStop(0, '#d24a26'); r.addColorStop(0.5, '#c01808'); r.addColorStop(1, '#7a0c06');
    g.fillStyle = r; g.fillRect(x, 2, w, mid - 3);
  };
  redCell(inX, cw3);
  redCell(inX + cw3, cw3);
  redCell(inX + cw3 * 2, cw3);
  // КАТАФОТ в средней верхней ячейке: призматическая сетка (читается как отражатель)
  {
    const x0 = inX + cw3 + 2, x1 = inX + cw3 * 2 - 2, y0 = 4, y1 = mid - 4;
    g.fillStyle = '#91411d'; g.fillRect(x0, y0, x1 - x0, y1 - y0); // катафот: приглушён (но виден)
    g.strokeStyle = 'rgba(90,10,4,0.55)'; g.lineWidth = 1;
    for (let x = x0; x <= x1; x += 3) { g.beginPath(); g.moveTo(x + 0.5, y0); g.lineTo(x + 0.5, y1); g.stroke(); }
    for (let y = y0; y <= y1; y += 3) { g.beginPath(); g.moveTo(x0, y + 0.5); g.lineTo(x1, y + 0.5); g.stroke(); }
  }
  // НИЗ: 2 ячейки — амбер (край) + белый (задний ход)
  const cw2 = inW / 2;
  const amber = g.createLinearGradient(0, mid, 0, H);
  amber.addColorStop(0, '#b28834'); amber.addColorStop(0.6, '#b2670b'); amber.addColorStop(1, '#552a03'); // приглушён (виден)
  g.fillStyle = amber; g.fillRect(inX, mid + 1, cw2, H - mid - 3);
  const cool = g.createLinearGradient(0, mid, 0, H);
  cool.addColorStop(0, '#abadb2'); cool.addColorStop(0.6, '#8f97a1'); cool.addColorStop(1, '#3f4854'); // приглушён (виден)
  g.fillStyle = cool; g.fillRect(inX + cw2, mid + 1, cw2, H - mid - 3);
  // ТЁМНЫЕ ПЕРЕГОРОДКИ (под тем же блюром → мягкие, как в тумане)
  g.fillStyle = '#100302';
  g.fillRect(0, mid - 1, W, 2);                  // горизонт-разделитель верх/низ
  g.fillRect(inX + cw3 - 1, 0, 2, mid);          // верт верх 1
  g.fillRect(inX + cw3 * 2 - 1, 0, 2, mid);      // верт верх 2
  g.fillRect(inX + cw2 - 1, mid, 2, H - mid);    // верт низ (амбер|белый)
  // ВЕРТИКАЛЬНЫЕ РЁБРА ЛИНЗЫ — рифление, читается как стекло
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 3; x < W; x += 4) g.fillRect(x, 0, 1, H);
  // тёмная рамка корпуса
  g.strokeStyle = '#0c0201'; g.lineWidth = 2;
  g.strokeRect(1, 1, W - 2, H - 2);
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

// --- общие геометрии: строятся один раз, делятся всеми машинами ----------
// (игрок, трафик, припаркованные, гараж). Цвет — только в материалах.
// Кто диспозит машины (traffic, garage), обязан пропускать эти геометрии.

/**
 * Кузов — ручной low-poly хулл: «лофт» из двух боковых профилей (лево/право),
 * правый чуть уже (сужение к бортам). Профиль кодирует длинный низкий капот,
 * пояс, короткий багажник и трапециевидные колёсные арки на дне.
 * Координаты сразу игровые: нос −z, ширина X, высота Y, низ колёс y=0.
 */
function buildBodyGeo(): THREE.BufferGeometry {
  const WIDTH = 1.68;
  // боковой профиль (x=длина, y=высота). Нос на x=−2.07. Обход: верх слева→
  // направо (нос→капот→пояс→багажник→корма), вниз, низ направо→налево с
  // трапециевидными арками (центр перед −1.41, зад +1.02; верх арки y=0.40).
  // перёд и зад почти вертикальны (как у 2107) — на них сидят фары.
  // носовая панель высокая и квадратная (не покатая как у гоночной)
  const pts: [number, number][] = [
    [-2.04, 0.78], // нос верх — высокий вертикальный торец вровень с капотом
    [-1.6, 0.82],  // капот (почти плоский, длинный)
    [-0.7, 0.84],  // база лобового (совпадает с базой кабины)
    [1.15, 0.84],  // база C-стойки
    [1.95, 0.80],  // багажник
    [2.06, 0.70],  // корма верх
    [2.07, 0.36],  // корма низ — задняя панель почти вертикальна
    [1.98, 0.24],  // под задним бампером
    [1.41, 0.24],  // зад арки — задний край низ
    [1.41, 0.42],  //            верх
    [0.63, 0.42],  // зад арки — передний край верх (центр +1.02)
    [0.63, 0.24],  //            низ
    [-1.03, 0.24], // перед арки — задний край низ
    [-1.03, 0.42], //             верх
    [-1.79, 0.42], // перед арки — передний край верх (центр −1.41)
    [-1.79, 0.24], //             низ
    [-1.98, 0.24], // под передним бампером
    [-2.07, 0.34], // нос низ — передняя панель почти вертикальна
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  // ExtrudeGeometry: профиль в XY, выдавливаем по +z на ширину; earcut сам
  // триангулирует невыпуклый контур (арки). Затем разворот в оси игры.
  const geo = new THREE.ExtrudeGeometry(shape, { depth: WIDTH, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -WIDTH / 2);  // центр ширины в 0
  geo.rotateY(-Math.PI / 2);        // длина (X) → z (нос −z), ширина → x
  geo.computeVertexNormals();
  return geo;
}

/**
 * Кабина-greenhouse — сужающийся 8-вершинный хулл: низ (пояс) шире и длиннее,
 * верх (крыша) уже и короче → наклонное лобовое, покат заднего, плоская
 * крыша, tumblehome. Координаты игровые. 12 треугольников.
 */
function buildGreenhouseGeo(): THREE.BufferGeometry {
  // длинная плоская крыша, мягкий tumblehome и наклон (как у седана 2107,
  // НЕ пирамида). Низ (пояс) шире/длиннее, верх (крыша) чуть уже/короче.
  const v = [
    [-0.78, 0.84, -0.70], [0.78, 0.84, -0.70], [0.78, 0.84, 1.15], [-0.78, 0.84, 1.15], // низ 0..3
    [-0.70, 1.42, -0.25], [0.70, 1.42, -0.25], [0.70, 1.42, 0.95], [-0.70, 1.42, 0.95],  // верх 4..7
  ];
  const faces = [
    [0, 1, 5], [0, 5, 4],   // лобовое (−z)
    [2, 3, 7], [2, 7, 6],   // заднее (+z)
    [3, 0, 4], [3, 4, 7],   // левый борт (−x)
    [1, 2, 6], [1, 6, 5],   // правый борт (+x)
    [4, 5, 6], [4, 6, 7],   // крыша (+y)
  ];
  const pos: number[] = [];
  for (const f of faces) for (const idx of f) pos.push(v[idx][0], v[idx][1], v[idx][2]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// общие текстуры фар: одинаковы у всех машин (узор линзы не зависит от цвета
// кузова). Раньше создавались на каждую машину (canvas+blur ×5 на инстанс →
// заметный расход при ~15 машинах трафика). Теперь — один раз.
const TAIL_TEX = taillightTexture();
const HEAD_TEX_L = headlightTexture();
const HEAD_TEX_R = (() => {
  const t = HEAD_TEX_L.clone();
  t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1;
  t.needsUpdate = true; return t;
})();
const TAIL_GLOW_TEX = tailGlowTexture();
const HEAD_GLOW_TEX = headGlowTexture();

const BODY_GEO = buildBodyGeo();
const GREENHOUSE_GEO = buildGreenhouseGeo();
const WHEEL_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.29, 0.29, 0.2, 16);
  g.rotateZ(Math.PI / 2);
  return g;
})();
const BUMPER_GEO = new THREE.BoxGeometry(1.72, 0.14, 0.18);
const GRILLE_GEO = new THREE.BoxGeometry(0.74, 0.2, 0.05);
const HEADLIGHT_GEO = new THREE.BoxGeometry(0.44, 0.2, 0.05);
const TAILLIGHT_GEO = new THREE.BoxGeometry(0.44, 0.17, 0.05); // широкий горизонтальный (как у 2107)
// правый фонарь — ЗЕРКАЛО левого (амбер-поворотник наружу у обоих). Тот же материал
// (стоп-анимация в Game правит ОДИН материал), отражаем через флип UV.x геометрии.
const TAILLIGHT_GEO_R = (() => {
  const geo = TAILLIGHT_GEO.clone();
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
  return geo;
})();

/** Общие геометрии машины — кто диспозит машину, должен их пропускать. */
export const SHARED_CAR_GEOS: Set<THREE.BufferGeometry> = new Set([
  BODY_GEO, GREENHOUSE_GEO, WHEEL_GEO, BUMPER_GEO, GRILLE_GEO, HEADLIGHT_GEO,
  TAILLIGHT_GEO, TAILLIGHT_GEO_R,
]);

/**
 * Низкополигональная «семёрка» (ВАЗ-2107): ручной хулл-кузов с арками,
 * сужающаяся кабина, хром-бамперы, решётка и фары. ~4.15 × 1.68 × 1.44 м.
 * lightsOn: false — припаркованная (фары и фонари потушены, без прожектора).
 */
export function buildCar(opts: { color?: number; lightsOn?: boolean; beam?: boolean } = {}): THREE.Group {
  const { color = 0x6b1220, lightsOn = true, beam = lightsOn } = opts;
  const car = new THREE.Group();

  // flatShading — фасеточный low-poly вид (грани кузова не сглаживаются)
  const cherry = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, flatShading: true });
  // кабина сплошная (без стёкол) — тёмная крыша, чтобы не было «дыры».
  // DoubleSide: хулл-кабина видна с любой стороны (не зависит от winding)
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d34, roughness: 0.5, metalness: 0.3, flatShading: true, side: THREE.DoubleSide,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.25, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95 });
  // передняя фара: текстурная линза (белый свет + оранжевый поворотник).
  // правая — зеркальная копия (поворотник наружу с обеих сторон)
  // материалы фар — per-instance (Game меняет накал), текстуры — общие
  const headMat = (tex: THREE.CanvasTexture) => lightsOn
    ? new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff,
        emissiveIntensity: 2.4, toneMapped: false,
      })
    : new THREE.MeshStandardMaterial({ color: 0x8d8c80, roughness: 0.3, metalness: 0.4 });
  const headlightL = headMat(HEAD_TEX_L);
  const headlightR = headMat(HEAD_TEX_R);
  // задняя фара: линза-эмиссив ТОЛЬКО на задней грани (+z, группа 4 BoxGeometry),
  // торцы/корпус — тёмный пластик. Иначе боковые грани коробки светятся текстурой
  // → «прозрачное стекло по рёбрам». Линза — per-instance (накал стопов в Game).
  const tailLens = new THREE.MeshStandardMaterial({
    map: TAIL_TEX, emissiveMap: TAIL_TEX, emissive: 0xffffff,
    emissiveIntensity: 0.65, toneMapped: false, // ночь+туман: приглушённый накал
  });
  const tailHousing = new THREE.MeshStandardMaterial({ color: 0x140404, roughness: 0.7 });
  const taillight: THREE.Material | THREE.Material[] = lightsOn
    ? [tailHousing, tailHousing, tailHousing, tailHousing, tailLens, tailHousing] // 4 = +z грань
    : new THREE.MeshStandardMaterial({ color: 0x4a1015, roughness: 0.4 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    car.add(m);
    return m;
  };

  // --- кузов по чертежу ВАЗ-2107 ---------------------------------------
  // длина 4145, ширина 1680, высота 1435, база 2424, свесы 664/1057 (мм).
  // нос в -z. Хулл-кузов с арками + сужающаяся кабина (общие геометрии).
  add(BODY_GEO, cherry, 0, 0, 0);
  add(GREENHOUSE_GEO, roofMat, 0, 0, 0);

  // бамперы (низко, обхватывают торцы)
  add(BUMPER_GEO, chrome, 0, 0.3, -2.02);
  add(BUMPER_GEO, chrome, 0, 0.3, 2.02);
  // решётка радиатора (центр-низ носовой панели)
  add(GRILLE_GEO, chrome, 0, 0.5, -2.06);
  // фары — проступают на носовой панели, выше решётки
  add(HEADLIGHT_GEO, headlightL, -0.56, 0.6, -2.07);
  add(HEADLIGHT_GEO, headlightR, 0.56, 0.6, -2.07);
  // белый ореол передних фар — мягкое свечение «в тумане». depthTest:true,
  // чтобы у своей машины кузов прятал ореол сзади, а у встречных — виден
  if (lightsOn) {
    for (const sx of [-0.56, 0.56]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: HEAD_GLOW_TEX, color: 0xfff0e0, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      spr.position.set(sx, 0.6, -2.13);
      spr.scale.set(1.1, 0.8, 1);
      car.add(spr);
    }
  }
  // габариты — широкие у внешних углов кормы, проступают наружу
  add(TAILLIGHT_GEO, taillight, -0.6, 0.55, 2.07).name = 'taillight'; // левый: амбер наружу (−x)
  add(TAILLIGHT_GEO_R, taillight, 0.6, 0.55, 2.07).name = 'taillight'; // правый: зеркало → амбер наружу (+x)
  // мягкий ореол свечения — фара «в тумане», аддитивно, ловится bloom.
  // depthTest: у ИГРОКА (beam) false — бампер на поворотах не протыкает ореол;
  // у ТРАФИКА true — иначе задний ореол просвечивает сквозь кузов встречных.
  if (lightsOn) {
    for (const sx of [-0.6, 0.6]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TAIL_GLOW_TEX, color: 0xff5230, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: !beam,
        toneMapped: false,
      }));
      spr.position.set(sx, 0.55, 2.13);
      spr.scale.set(1.3, 0.7, 1); // outer glow вокруг фонаря
      spr.name = 'tailglow';
      car.add(spr);
    }
  }

  // колёса: радиус 0.29, оси перед −1.41 / зад +1.02 (центры арок), x ±0.71
  for (const [wx, wz] of [[-0.71, -1.41], [0.71, -1.41], [-0.71, 1.02], [0.71, 1.02]])
    add(WHEEL_GEO, rubber, wx, 0.29, wz);

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
