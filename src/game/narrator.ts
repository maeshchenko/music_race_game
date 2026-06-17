/**
 * Нарратор — суб-полоса снизу (The Stanley Parable vibe). Текст печатается по
 * букве, держится, гаснет. Только текст, ноль аудио-ассетов. Реплики приходят
 * из story.ts по дистанции и комментируют спуск (в финале ломают 4-ю стену).
 *
 * Один DOM-элемент, очередь строк. Никаких аллокаций в кадре кроме textContent.
 */
export class Narrator {
  private el: HTMLDivElement;
  private queue: string[] = [];
  private full = '';
  private shown = 0;     // сколько символов раскрыто
  private t = 0;        // таймер текущей стадии
  private stage: 'idle' | 'type' | 'hold' | 'fade' = 'idle';

  private static readonly CPS = 34;   // символов/сек (печать)
  private static readonly HOLD = 3.2; // держим после печати, сек
  private static readonly FADE = 0.9; // затухание, сек

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'narrator';
    this.el.style.cssText = [
      'position:absolute', 'left:50%', 'bottom:11%', 'transform:translateX(-50%)',
      'z-index:6', 'pointer-events:none', 'max-width:62%', 'text-align:center',
      "font:italic 500 clamp(15px,2.2vw,22px)/1.4 Georgia,'Times New Roman',serif",
      'color:#e8e6df', 'text-shadow:0 2px 10px #000,0 0 22px #0008',
      'letter-spacing:.02em', 'opacity:0', 'transition:none',
      'white-space:pre-wrap',
    ].join(';');
    container.appendChild(this.el);
  }

  /** Поставить реплику в очередь. */
  say(text: string) { this.queue.push(text); }

  /** Закрепить строку НАВСЕГДА (без печати/фейда) — для подсказки управления
   *  (напр. Y/N в финале). Сбрасывается `clear()`. */
  pin(text: string) {
    this.queue.length = 0;
    this.full = text;
    this.shown = text.length;
    this.el.textContent = text;
    this.el.style.opacity = '1';
    this.pinned = true;
  }
  private pinned = false;

  /** Очистить очередь и текущую строку (вход в фазу/сброс). */
  clear() {
    this.queue.length = 0;
    this.stage = 'idle';
    this.pinned = false;
    this.el.style.opacity = '0';
    this.el.textContent = '';
  }

  update(dt: number) {
    if (this.pinned) return; // закреплённая подсказка не печатается/не гаснет
    if (this.stage === 'idle') {
      const next = this.queue.shift();
      if (!next) return;
      this.full = next;
      this.shown = 0;
      this.t = 0;
      this.stage = 'type';
      this.el.textContent = '';
      this.el.style.opacity = '1';
      return;
    }
    this.t += dt;
    if (this.stage === 'type') {
      const target = Math.min(this.full.length, Math.floor(this.t * Narrator.CPS));
      if (target !== this.shown) {
        this.shown = target;
        this.el.textContent = this.full.slice(0, this.shown);
      }
      if (this.shown >= this.full.length) { this.stage = 'hold'; this.t = 0; }
    } else if (this.stage === 'hold') {
      if (this.t >= Narrator.HOLD) { this.stage = 'fade'; this.t = 0; }
    } else if (this.stage === 'fade') {
      this.el.style.opacity = String(Math.max(0, 1 - this.t / Narrator.FADE));
      if (this.t >= Narrator.FADE) { this.stage = 'idle'; this.el.style.opacity = '0'; }
    }
  }

  dispose() { this.el.remove(); }
}
