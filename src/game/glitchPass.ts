import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Глитч-пасс «сходит с ума» — один полноэкранный шейдер, гонится ОДНИМ
 * скаляром uInsanity 0..1 (story.ts → IntensityDirector). Дёшево: RGB-сдвиг
 * (хроматическая аберрация), построчный jitter, редкие инверт-вспышки. На нуле
 * — практически no-op (return tex). Только десктоп (на мобайле composer нет).
 *
 * Вставляется между bloom и OutputPass. Обновляй uTime/uInsanity каждый кадр.
 */
const GlitchShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uInsanity: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uInsanity;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    // дешёвый хеш-шум
    float hash(float x) { return fract(sin(x * 43758.5453) * 12345.6789); }

    void main() {
      float ins = uInsanity;
      vec2 uv = vUv;

      // построчный горизонтальный jitter — редкие «срывы кадра»
      float line = floor(uv.y * 220.0);
      float glitchAmt = step(0.96 - ins * 0.25, hash(line + floor(uTime * 12.0)));
      float shove = (hash(line * 1.7 + floor(uTime * 9.0)) - 0.5) * glitchAmt * ins * 0.06;
      uv.x += shove;

      // хроматическая аберрация — расходятся каналы R/B от центра
      vec2 dir = uv - 0.5;
      float ca = (0.002 + ins * 0.012) * (0.5 + length(dir));
      vec2 off = vec2(ca / uAspect, 0.0);
      float r = texture2D(tDiffuse, uv + off).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - off).b;
      vec3 col = vec3(r, g, b);

      // лёгкая «больная» волна по яркости + сканлайн
      float scan = 1.0 - ins * 0.08 * (0.5 + 0.5 * sin(uv.y * 800.0 + uTime * 6.0));
      col *= scan;

      // редкие инверт-вспышки на высоком безумии
      float flash = step(0.992, hash(floor(uTime * 7.0))) * step(0.55, ins);
      col = mix(col, 1.0 - col, flash * 0.85);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function makeGlitchPass(): ShaderPass {
  const pass = new ShaderPass(GlitchShader);
  return pass;
}
