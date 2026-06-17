# «Съезд» — понятность перехода: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать переход гонка→краш→пеший лес безошибочно читаемым как авторская задумка (не проигрыш/баг) и подсказать игроку идти к воде — без туториал-попапа.

**Architecture:** Слой онбординга поверх существующей арки «Съезд». Правки копирайта реплик в `story.ts`; в `game.ts` — леттербокс, постоянная подсказка через `narrator.pin`, машина состояний бездействия (idle-ladder), маяк-свет к воде, foreshadow-пульсы. Переиспользуем `narrator`, `IntensityDirector`, `conductor`, `hideRaceHud`. Без новых ассетов и без тест-фреймворка (его в проекте нет).

**Tech Stack:** TypeScript, Vite, Three.js, Tone.js. DOM/CSS для оверлеев.

## Global Constraints

- Тон фикса: **Баланс** — диегетика первой, явный UI только как fallback по таймауту бездействия.
- НИКОГДА не использовать fail-лексику на сломе: ни «гонка закончилась», ни красного цвета, ни модалки, ни кнопки restart/retry.
- Anti-Navi: idle-таймер сбрасывается на ЛЮБОЙ ввод (W/A/D/стрелки/кириллица или движение камеры мышью). Активный игрок не видит подсказок.
- Диаг-логи проекта НЕ удалять (память `keep-perf-logs`).
- Инвариант: консоль браузера чистая (ноль ошибок) после каждого шага.
- Верификация: `npm run typecheck` (0 ошибок) + ручная проверка в браузере через dev-триггеры. Автотестов нет.
- **Коммиты — на усмотрение пользователя (правило проекта). Агент сам НЕ коммитит; в конце задачи — чекпоинт верификации, без `git commit`.**
- Финальные формулировки реплик согласованы в спеке; при сомнении оставить как здесь.
- Dev-триггеры: `?story=forest|grove|lake` (старт с фазы), `Shift+1..6` (прыжки фаз), `Z` (встать перед поворотом-крашем), `C` (смена вида).

---

### Task 1: Переписать реплики — убрать скилл-чек и game-over

**Files:**
- Modify: `src/game/story.ts:75-89` (массивы `narrate` фаз `race` и `forest`)

**Interfaces:**
- Consumes: ничего.
- Produces: реплики читаются `Story.pendingNarration` → `narrator.say` (без изменений сигнатур).

- [ ] **Step 1: Переписать реплики подъезда (фаза `race`)**

В `src/game/story.ts`, в `PHASES`, фаза `race`, заменить два последних cue:

```typescript
    narrate: [ // распорядитель → непроходимый поворот (неизбежность, НЕ приказ тормозить)
      { atOff: 700, text: 'Супер!' },
      { atOff: 2000, text: 'Хорошо идешь!' },
      { atOff: 3920, text: 'Впереди поворот… Я его сюда не ставил.' },
      { atOff: 3975, text: 'Держись.' },
    ] },
```

- [ ] **Step 2: Переписать ключевую реплику краша (фаза `forest`, atOff:0)**

Заменить cue `atOff:0` (и смягчить 40/90 под новый тон — вперёд, без «гонка закончилась»):

```typescript
    narrate: [ // после краша: голос растерян, но смотрит ВПЕРЁД (без game-over лексики)
      { atOff: 0, text: '…Дальше дороги нет. А лес — есть.' },
      { atOff: 40, text: 'Ехать больше не на чем. Дальше — пешком.' },
      { atOff: 90, text: 'Я не создавал этот маршрут. И этот лес… Откуда он здесь?' },
    ] },
```

- [ ] **Step 3: Типчек**

Run: `npm run typecheck`
Expected: 0 ошибок.

- [ ] **Step 4: Ручная проверка**

Run: `npm run dev`, открыть с `?story=forest` И отдельно нажать `Z` в обычном заезде (встать перед поворотом).
Expected: на подъезде нарратор говорит «Впереди поворот… Я его сюда не ставил.» / «Держись.» (НЕ «Сбрасывай/Тормози»); сразу после краша — «…Дальше дороги нет. А лес — есть.» (НЕ «гонка закончилась»). Консоль чистая.

- [ ] **Step 5: Чекпоинт** — typecheck чистый + наблюдения совпали. (Коммит — по усмотрению пользователя.)

---

### Task 2: Леттербокс + плавное гашение HUD на крахе

**Files:**
- Modify: `src/game/game.ts` (новые методы `showLetterbox`/`hideLetterbox` рядом с `showWalkHint` ~535; правка `hideRaceHud` ~526; вызовы в блоке подъезда ~1247-1269 и крах-блоке ~1323-1344 и settle-блоке ~1407-1423)

**Interfaces:**
- Consumes: `this.fx` (HTMLElement-слой), `this.crashArmed`, `this.story.metersToForest(dist)`.
- Produces: поля `private letterbox: HTMLDivElement | null`, `private letterboxShown = false`; методы `showLetterbox()`, `hideLetterbox()`.

- [ ] **Step 1: Добавить поля и методы леттербокса**

В `src/game/game.ts` рядом с `showWalkHint` добавить:

```typescript
  private letterbox: HTMLDivElement | null = null;
  private letterboxShown = false;
  /** Кино-полосы (top+bottom): сигнал «катсцена, откинься». Въезжают перед апексом. */
  private showLetterbox() {
    if (this.letterbox) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;z-index:9;pointer-events:none';
    const bar = (top: boolean) =>
      `position:absolute;left:0;right:0;${top ? 'top' : 'bottom'}:0;height:0;`
      + 'background:#000;transition:height 1s ease';
    const t = document.createElement('div'); t.style.cssText = bar(true);
    const b = document.createElement('div'); b.style.cssText = bar(false);
    wrap.appendChild(t); wrap.appendChild(b);
    this.fx.appendChild(wrap);
    this.letterbox = wrap;
    requestAnimationFrame(() => {
      if (this.letterbox) { t.style.height = '11%'; b.style.height = '11%'; }
    });
  }
  /** Полосы уезжают (вернулось пешее управление). */
  private hideLetterbox() {
    if (!this.letterbox) return;
    const wrap = this.letterbox; this.letterbox = null;
    for (const c of Array.from(wrap.children)) (c as HTMLDivElement).style.height = '0';
    setTimeout(() => { if (!this.disposed) wrap.remove(); }, 1100);
  }
```

- [ ] **Step 2: HUD гаснет плавно, не snap**

Заменить тело `hideRaceHud` (~526-531) на fade через opacity:

```typescript
  private hideRaceHud() {
    for (const el of [
      this.hud, this.feverEdge, this.comboBar, this.comboRingWrap,
      this.odBar, this.odIcon, this.odPrompt, this.turboFx, this.goalEl,
    ]) {
      if (!el) continue;
      el.style.transition = 'opacity .8s ease';
      el.style.opacity = '0';
      setTimeout(() => { if (!this.disposed) el.style.display = 'none'; }, 850);
    }
  }
```

- [ ] **Step 3: Поднять полосы за ~40 м до апекса**

В блоке подъезда (`if (this.story && !this.walkMode)`, после `metersToForest`, ~1248) добавить, используя уже вычисленный `m`:

```typescript
      if (this.crashArmed && !this.letterboxShown && m > 0 && m < 40) {
        this.letterboxShown = true;
        this.showLetterbox();
      }
```

- [ ] **Step 4: Полосы уезжают в settle (конец краша)**

В settle-блоке (`if (this.crashUntil > 0 && !crashing && !this.wrecked)`, ~1407) добавить в конце, после `this.world.clearCrashBend()` логики:

```typescript
      this.hideLetterbox();
```

- [ ] **Step 5: Типчек**

Run: `npm run typecheck`
Expected: 0 ошибок.

- [ ] **Step 6: Ручная проверка**

Run: `npm run dev`, нажать `Z` (встать перед поворотом) и доехать до краша.
Expected: за ~40 м до апекса въезжают чёрные полосы сверху/снизу; гоночный HUD плавно гаснет; после кувырка (~3.6 с) полосы уезжают. Консоль чистая.

- [ ] **Step 7: Чекпоинт** — typecheck чистый + наблюдения совпали.

---

### Task 3: Постоянная подсказка управления вместо транзиентной

**Files:**
- Modify: `src/game/game.ts` (крах-блок ~1338-1339: убрать `showWalkHint`; settle/wrecked ~1422: заменить `pop`; добавить unpin при первом движении в `walkMode`)

**Interfaces:**
- Consumes: `this.narrator.pin(text)`, `this.narrator.clear()` (снимает pin), `this.keyFwd/keyLeft/keyRight`, `this.walkMode`.
- Produces: поле `private walkHintCleared = false`.

- [ ] **Step 1: В крах-блоке заменить транзиентную подсказку на pin**

В блоке `if (st.enteredPhase === 'forest')` (~1338-1339) убрать строку `this.showWalkHint();` и вместо неё закрепить подсказку нарратором ПОСЛЕ краша. Поскольку реплики краша gated на время кувырка, ставим pin в settle-блоке (Step 2). Здесь только удалить вызов `this.showWalkHint();`.

(Метод `showWalkHint` можно оставить в файле неиспользуемым? Нет — `tsc` с noUnusedLocals может ругаться на приватный метод только если включено `noUnusedLocals`; приватные методы оно НЕ проверяет. Безопасно оставить. Если build ругнётся — удалить метод `showWalkHint` и поле `walkHint`.)

- [ ] **Step 2: В settle-блоке заменить `pop(...)` на постоянный pin**

В settle-блоке (~1422) заменить:

```typescript
      this.pop('⌨ WASD — ИДТИ · МЫШЬ — КАМЕРА · C — ВИД', 'pop-theme pop-mega');
```

на:

```typescript
      this.narrator?.pin('Иди вперёд — W · мышь — оглядеться');
```

- [ ] **Step 3: Снять pin при первом движении**

Добавить поле рядом с `walkMode`:

```typescript
  private walkHintCleared = false;
```

В `tick()`, в ветке `walkMode` движения (там где `if (!this.paused && !this.frozen && this.keyFwd)` ~1236), сразу после неё добавить снятие подсказки при первом реальном вводе:

```typescript
      if (!this.walkHintCleared && (this.keyFwd || this.keyLeft || this.keyRight)) {
        this.walkHintCleared = true;
        this.narrator?.clear();
      }
```

- [ ] **Step 4: Типчек**

Run: `npm run typecheck`
Expected: 0 ошибок (если ругань на неиспользуемый `showWalkHint`/`walkHint` — удалить их).

- [ ] **Step 5: Ручная проверка**

Run: `npm run dev`, `?story=forest`.
Expected: после краша внизу ЗАКРЕПЛЕНА строка «Иди вперёд — W · мышь — оглядеться», держится (не гаснет). При первом нажатии W подсказка пропадает, начинается ходьба + звук шага. Консоль чистая.

- [ ] **Step 6: Чекпоинт** — typecheck чистый + наблюдения совпали.

---

### Task 4: Лестница эскалации при бездействии (idle-ladder)

**Files:**
- Modify: `src/game/game.ts` (новые поля; сброс в `onKey` ~436 и `onMouse` ~995; тик-машина в ветке `walkMode`)

**Interfaces:**
- Consumes: `this.walkMode`, `this.frozen`, `this.narrator`, маяк (поле `this.beacon` появится в Task 5 — здесь только ступень 2/3, ступень света будет привязана в Task 5 через флаг `idleStage`).
- Produces: поля `private idleT = 0`, `private idleStage = 0`, `private idleReset = false`. Ступень `idleStage` 0..3 читается Task 5 для яркости маяка.

- [ ] **Step 1: Добавить поля idle-машины**

Рядом с `walkHintCleared`:

```typescript
  private idleT = 0;       // сек бездействия в пешем режиме
  private idleStage = 0;   // 0 ничего · 1 маяк ярче · 2 мягкая реплика · 3 явные клавиши
  private idleReset = false; // ввод в этом кадре → сброс лестницы
```

- [ ] **Step 2: Сбрасывать на вводе с клавиатуры**

В `onKey` (~436, где ставятся `keyFwd/keyLeft/keyRight = true`) добавить в конце соответствующих веток (или единым блоком после них):

```typescript
    if (Game.isFwd(e) || Game.isLeft(e) || Game.isRight(e)) this.idleReset = true;
```

- [ ] **Step 3: Сбрасывать на движении камеры мышью**

В обработчике `onMouse` (~995, начало функции) добавить:

```typescript
    this.idleReset = true;
```

- [ ] **Step 4: Тик-машина бездействия**

В `tick()`, внутри блока `if (this.story && !this.paused)`, в ветке `if (this.walkMode)` (рядом с увод музыки ~1350), добавить обработку лестницы. Тикает только пока идём и не на берегу:

```typescript
      // ЛЕСТНИЦА ПОДСКАЗОК ПРИ БЕЗДЕЙСТВИИ (anti-Navi: сброс на любой ввод).
      if (this.walkMode && !this.frozen && !this.walkHintCleared) {
        if (this.idleReset) { this.idleT = 0; this.idleStage = 0; this.idleReset = false; }
        else this.idleT += dt;
        if (this.idleStage < 1 && this.idleT >= 10) this.idleStage = 1; // маяк ярче (Task 5)
        if (this.idleStage < 2 && this.idleT >= 20) {
          this.idleStage = 2; this.narrator?.say('Здесь больше ничего. Иди к воде.');
        }
        if (this.idleStage < 3 && this.idleT >= 35) {
          this.idleStage = 3; this.narrator?.say('Нажми W или ↑ — идти.');
        }
      } else {
        this.idleReset = false; // не копим ввод вне пешей фазы
      }
```

(Примечание: пока активна закреплённая подсказка из Task 3, `narrator.say` встаёт в очередь, но `pinned` блокирует печать — это ОК: ступени 2/3 нужны только если игрок реально завис, а подсказка-pin к тому моменту ещё висит. Чтобы ступени были видны, на ступени 2 сначала снимаем pin.)

- [ ] **Step 5: На ступени 2 снять pin, чтобы реплики печатались**

В блоке ступени 2 (idleT>=20) перед `narrator.say` добавить снятие pin:

```typescript
          this.idleStage = 2; this.narrator?.clear(); this.narrator?.say('Здесь больше ничего. Иди к воде.');
```

- [ ] **Step 6: Типчек**

Run: `npm run typecheck`
Expected: 0 ошибок.

- [ ] **Step 7: Ручная проверка**

Run: `npm run dev`, `?story=forest`, НЕ трогать управление.
Expected: ~10 с — (маяк ярче появится в Task 5; пока без визуала), ~20 с — печатается «Здесь больше ничего. Иди к воде.», ~35 с — «Нажми W или ↑ — идти.». Любое нажатие W/A/D или движение мыши сбрасывает: после сброса 35 с снова с нуля. Консоль чистая.

- [ ] **Step 8: Чекпоинт** — typecheck чистый + наблюдения совпали.

---

### Task 5: Маяк-свет к воде + проверка награды за первый шаг

**Files:**
- Modify: `src/game/game.ts` (создание `this.beacon` в крах-блоке; яркость по `idleStage` в ветке `walkMode`; импорт THREE уже есть)

**Interfaces:**
- Consumes: `this.world.scene`, `this.story.zoneStarts()` (возвращает `[forestStart, groveStart, lakeStart]`), `this.level.curveAt(dist)`, `this.groundY(dist)`, `this.idleStage` (Task 4).
- Produces: поле `private beacon: THREE.PointLight | null`.

- [ ] **Step 1: Добавить поле маяка**

```typescript
  private beacon: THREE.PointLight | null = null;
```

- [ ] **Step 2: Создать тёплый маяк у воды на крахе**

В блоке `if (st.enteredPhase === 'forest')` (~1337, рядом с созданием `runner`) добавить маяк в точке начала озёрной зоны (ведущая точка вдали по тропе):

```typescript
        if (!this.beacon) {
          const lakeStart = this.story.zoneStarts()[2];
          const bx = this.level.curveAt(lakeStart);
          this.beacon = new THREE.PointLight(0xffd9a0, 0, 220, 1.6); // тёплый, distance 220
          this.beacon.position.set(bx, this.groundY(lakeStart) + 6, -lakeStart);
          this.world.scene.add(this.beacon);
        }
```

- [ ] **Step 3: Маяк дышит и ярче при бездействии**

В ветке `if (this.walkMode)` (рядом с idle-машиной, Task 4) добавить управление яркостью. Базовая мягкая яркость + буст на `idleStage>=1`:

```typescript
      if (this.beacon) {
        const want = this.idleStage >= 1 ? 3.2 : 1.1; // ярче, если игрок завис
        this.beacon.intensity += (want - this.beacon.intensity) * Math.min(1, dt * 1.5);
      }
```

- [ ] **Step 4: Убрать маяк при входе на берег (freeze) — он уже не нужен**

В обработке `st.enteredPhase === 'lake'` (~1358) добавить мягкое гашение через установку флага; проще — в той же ветке `walkMode`, если `this.frozen` и есть beacon, гасить к 0:

```typescript
      if (this.beacon && this.frozen) {
        this.beacon.intensity += (0 - this.beacon.intensity) * Math.min(1, dt * 1.5);
      }
```

- [ ] **Step 5: Проверить награду за первый шаг (без правок, если уже ОК)**

Подтвердить, что `this.sfx.footstep()` вызывается на первом W (строка ~1474: `if (this.runner.update(dist, this.keyFwd && !this.frozen ? 5.0 : 0)) this.sfx.footstep();`). Если шаг не слышен сразу — НЕ менять в этой задаче, занести как баг отдельно.

- [ ] **Step 6: Типчек**

Run: `npm run typecheck`
Expected: 0 ошибок.

- [ ] **Step 7: Ручная проверка**

Run: `npm run dev`, `?story=forest`.
Expected: после краша вдали по тропе виден тёплый огонёк (маяк), мягко притягивает взгляд; при бездействии (~10 с) он заметно ярче; при ходьбе к воде остаётся ориентиром; на берегу гаснет. Первый W — слышен шаг. Консоль чистая.

- [ ] **Step 8: Чекпоинт** — typecheck чистый + наблюдения совпали.

---

### Task 6: Лёгкий foreshadow в гонке (тонкие «волны»)

**Files:**
- Modify: `src/game/story.ts` (одна ранняя двусмысленная реплика в фазе `race`); `src/game/game.ts` (foreshadow-пульс insanity по ранним порогам)

**Interfaces:**
- Consumes: `this.director.setInsanity(x)` (IntensityDirector — `insanity` лерпится ~1.5 с, краткий bump = мягкая волна), `this.story` (фаза race), `dist`.
- Produces: поля `private foreshadowIdx = 0`, статический массив порогов.

- [ ] **Step 1: Добавить раннюю двусмысленную реплику (фаза `race`)**

В `src/game/story.ts`, фаза `race`, добавить cue между 2000 и 3920:

```typescript
      { atOff: 2600, text: '…ты слышал? Нет, показалось.' },
```

- [ ] **Step 2: Добавить поля foreshadow-пульса в game.ts**

Рядом с другими полями состояния спуска:

```typescript
  private foreshadowIdx = 0;
  private static readonly FORESHADOW_AT = [1500, 2800]; // м: тонкие «волны» до подъезда
```

- [ ] **Step 3: Триггерить мягкий bump insanity и спад**

В `tick()`, в блоке `if (this.story && !this.paused)` (до того как story берёт руль; только в фазе race и до подъезда), добавить:

```typescript
      // FORESHADOW: тонкие ранние «волны» — учим словарь «что-то не так».
      if (!this.story.active && !this.walkMode
          && this.foreshadowIdx < Game.FORESHADOW_AT.length
          && dist >= Game.FORESHADOW_AT[this.foreshadowIdx]) {
        this.foreshadowIdx++;
        this.director.setInsanity(0.22);                 // лёгкий всплеск (лерп ~1.5с)
        setTimeout(() => { if (!this.disposed && !this.story?.active) this.director.setInsanity(0); }, 420);
      }
```

(Во время штатной гонки `director.setInsanity` обычно 0; story берёт руль только в лесу+, так что сброс безопасен. Проверить, что обычная гонка не ставит insanity где-то ещё; если ставит — этот сброс на ту же цель, эффект тот же.)

- [ ] **Step 4: Типчек**

Run: `npm run typecheck`
Expected: 0 ошибок.

- [ ] **Step 5: Ручная проверка**

Run: `npm run dev`, обычный заезд от старта (без триггеров), смотреть на ~1500 и ~2800 м.
Expected: дважды по дороге проходит едва заметная «волна» (короткий глитч/крен, ~0.5–1 с, затем в норму); на ~2600 м нарратор роняет «…ты слышал? Нет, показалось.». Эффект тонкий, не пугающий. Консоль чистая.

- [ ] **Step 6: Чекпоинт** — typecheck чистый + наблюдения совпали.

---

## Финальная сквозная проверка (после всех задач)

Run: `npm run dev`, полный заезд от старта (без триггеров) ИЛИ `Z` для ускорения до поворота.

Чек-лист (повторяет провал теста):
1. На ~1500/2800 м — тонкие волны; ~2600 м — двусмысленная реплика (foreshadow).
2. Подъезд: реплики НЕ приказывают тормозить; поворот читается как неизбежный.
3. Краш: въехали полосы, HUD плавно погас, голос «…Дальше дороги нет. А лес — есть.» — ни красного, ни «гонка закончилась», ни модалки.
4. После краша: полосы уехали, внизу закреплено «Иди вперёд — W · мышь — оглядеться»; вдали тёплый маяк к воде.
5. Бездействие 10/20/35 с → маяк ярче → «Иди к воде.» → «Нажми W…». Любой ввод сбрасывает.
6. Первый W → шаг + звук; подсказка-pin исчезает.
7. Дошёл к озеру — маяк погас, садишься, титры/финал как раньше.
8. Консоль чистая на всём пути.

Run: `npm run build`
Expected: `tsc --noEmit` без ошибок + vite build успешен.
