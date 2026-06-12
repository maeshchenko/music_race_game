/** Тач-устройство: телефон/планшет — экономим CPU и GPU. */
export const IS_MOBILE =
  matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
