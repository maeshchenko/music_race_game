import * as THREE from 'three';

/**
 * Бегущий человечек (сюр-спуск, фаза onfoot, клавиша P). Выбегает из машины —
 * дальше бежишь, а не едешь. Голый: голова, тело, две руки, две ноги. Конечности
 * РЕАЛЬНО двигаются: фаза шага берётся из ДИСТАНЦИИ, поэтому шаги совпадают с
 * прокруткой дороги, а амплитуда/каденс растут со скоростью. Лицом в -z (как
 * машина) — ракурс камеры не меняется.
 *
 * Конструкция: руки/ноги висят на ПИВОТ-группах в плече/бедре, качаются вокруг
 * оси X. Корпус слегка наклонён вперёд (бег), всё тело подпрыгивает (bob).
 */
export class Runner {
  readonly group = new THREE.Group();
  private body = new THREE.Group(); // подпрыгивает; корни конечностей внутри
  private armL: THREE.Group; private armR: THREE.Group;
  private legL: THREE.Group; private legR: THREE.Group;
  private torso: THREE.Group;
  private stepIndex = 0; // индекс последнего приземления стопы — для звука шага

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xddae8a, roughness: 0.75, flatShading: true });

    // пивот конечности: группа в суставе + меш, свисающий вниз на half-длину
    const limb = (w: number, len: number, jointX: number, jointY: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(jointX, jointY, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), skin);
      m.position.y = -len / 2;
      pivot.add(m);
      return pivot;
    };

    this.torso = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.78, 0.28), skin);
    trunk.position.y = 1.18;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
    head.position.y = 1.74;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 6), skin);
    neck.position.y = 1.56;
    this.torso.add(trunk, neck, head);

    this.armL = limb(0.14, 0.72, 0.32, 1.48);
    this.armR = limb(0.14, 0.72, -0.32, 1.48);
    this.legL = limb(0.17, 0.86, 0.14, 0.86);
    this.legR = limb(0.17, 0.86, -0.14, 0.86);

    this.body.add(this.torso, this.armL, this.armR, this.legL, this.legR);
    this.body.rotation.x = 0.12; // лёгкий наклон корпуса вперёд (бег)
    this.group.add(this.body);
    this.group.visible = false;
  }

  /**
   * Анимация бега. dist — дистанция (м): фаза шага = dist·k, поэтому ноги
   * «отталкиваются» синхронно с землёй. speed (м/с) — амплитуда/подскок.
   * Возвращает true в кадре, когда стопа КАСАЕТСЯ земли (для звука шага); стоим
   * (speed≈0) — всегда false.
   */
  update(dist: number, speed: number): boolean {
    if (speed <= 0.01) {
      // СТОИТ РОВНО (берег/freeze): конечности по швам, корпус прямой, без подскока —
      // спокойная стойка, а не «замер посреди шага»
      this.armL.rotation.x = 0; this.armR.rotation.x = 0;
      this.legL.rotation.x = 0; this.legR.rotation.x = 0;
      this.body.position.y = 0;
      this.body.rotation.x = 0; // убрать беговой наклон вперёд
      this.torso.rotation.z = 0;
      return false;
    }
    this.body.rotation.x = 0.12; // беговой наклон корпуса (на ходу)
    const phase = dist * 1.15; // циклов на метр → шаг привязан к дороге
    const sw = Math.sin(phase);
    const amp = THREE.MathUtils.clamp(0.5 + speed * 0.02, 0.5, 1.2); // быстрее — шире шаг
    // руки и ноги в противофазе (левая рука — с правой ногой)
    this.armL.rotation.x = sw * amp * 0.8;
    this.armR.rotation.x = -sw * amp * 0.8;
    this.legL.rotation.x = -sw * amp;
    this.legR.rotation.x = sw * amp;
    // подскок тела на каждый шаг (две точки опоры за цикл → 2× частота)
    this.body.position.y = Math.abs(Math.cos(phase)) * amp * 0.12;
    // лёгкое раскачивание плеч
    this.torso.rotation.z = sw * 0.05;
    // ПРИЗЕМЛЕНИЕ стопы: тело в нижней точке (|cos|→0) на фазах π/2+nπ — две
    // опоры за цикл. Индекс растёт на 1 на каждом касании → звук ровно по ноге.
    const idx = Math.floor(phase / Math.PI - 0.5);
    if (idx !== this.stepIndex) { this.stepIndex = idx; return true; }
    return false;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
