/**
 * The 3D map's shaders (GLSL 3, WebGL 2). Positions arrive quantised (Int16) and are dequantised on
 * the GPU; systems are summed additively into a half-float buffer, then tone-mapped onto the screen so
 * the Bubble and the core stay coloured instead of burning to white (G0's finding).
 *
 * Game space → three space: (x, y, z) → (x, y, -z). The game's +z (toward the core) is three's -z.
 */

const pointCommon = /* glsl */ `
  uniform float uSize;       // light years a point stands for, before clamping
  uniform float uViewH;      // drawing-buffer height, px
  uniform float uIntensity;
  uniform float uMode;       // 0 evidence, 1 species count, 2 value
  uniform float uMinValue;   // G5: systems worth less (100 k CR units) are not drawn
  uniform float uMinSize;    // G5: with a floor, the few left are drawn bigger (px)
  uniform float uFilter;     // the Filter drawer (2026-10-04): 0 off, 1 dim the rest, 2 hide the rest
  uniform float uMatchBoost; // light for the systems that match, which may be few
  in float aTiers;
  in float aSpecies;
  in float aValue;           // 100 k CR units
  in float aMatch;           // 1 when the system passes the filter
  out vec3 vColor;

  vec3 colourFor(float t, float sp) {
    if (uMode > 1.5) {
      // Value, on a log scale: 100 k → dim blue, 10 M → teal, 100 M → amber, 1 bn+ → white-gold.
      float k = clamp(log(max(aValue, 1.0)) / log(10000.0), 0.0, 1.0);
      vec3 lo = mix(vec3(0.16, 0.2, 0.5), vec3(0.25, 0.85, 0.8), smoothstep(0.0, 0.5, k));
      return mix(lo, vec3(1.0, 0.8, 0.4), smoothstep(0.5, 1.0, k));
    }
    if (uMode < 0.5) {
      bool dss = mod(floor(t / 2.0), 2.0) > 0.5;
      bool codex = mod(floor(t / 4.0), 2.0) > 0.5;
      // Mapped (DSS) teal, codex-logged amber, signals only violet.
      return dss ? vec3(0.25, 0.85, 0.8) : codex ? vec3(1.0, 0.62, 0.2) : vec3(0.55, 0.45, 0.95);
    }
    float k = clamp(sp / 8.0, 0.0, 1.0);
    return mix(vec3(0.2, 0.3, 0.75), vec3(1.0, 0.93, 0.8), k);
  }

  void emit(vec3 g) {
    if (aValue < uMinValue || (uFilter > 1.5 && aMatch < 0.5)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec3(0.0);
      return;
    }
    vec4 mv = modelViewMatrix * vec4(g.x, g.y, -g.z, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uViewH * 2.0 / -mv.z, uMinSize, 9.0);
    vColor = colourFor(aTiers, aSpecies) * uIntensity;
    if (uFilter > 0.5) {
      // The ones that have it brighter and never smaller than 3.5 px; the rest a faint haze.
      if (aMatch > 0.5) {
        gl_PointSize = max(gl_PointSize, 3.5);
        vColor *= uMatchBoost;
      } else {
        vColor *= 0.06;
      }
    }
  }
`;

/** The whole-galaxy overview; hides its points where a close-up tile has landed. */
export const overviewVertex = /* glsl */ `
  uniform vec3 uMin;
  uniform vec3 uStep;
  uniform sampler2D uMask;
  uniform float uMaskOn;
  uniform vec3 uGridOrigin;
  uniform float uCellSize;
  uniform vec3 uCellMin;
  uniform vec3 uCellDims;
  ${pointCommon}
  void main() {
    vec3 g = uMin + (position + 32768.0) * uStep;
    if (uMaskOn > 0.5) {
      vec3 c = floor((g - uGridOrigin) / uCellSize) - uCellMin;
      if (all(greaterThanEqual(c, vec3(0.0))) && all(lessThan(c, uCellDims))) {
        float m = texelFetch(uMask, ivec2(int(c.x), int(c.y * uCellDims.z + c.z)), 0).r;
        if (m > 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = 0.0;
          vColor = vec3(0.0);
          return;
        }
      }
    }
    emit(g);
  }
`;

/** One close-up tile: positions inside its 1,280 ly cube. */
export const tileVertex = /* glsl */ `
  uniform vec3 uCellMinLy;
  uniform float uTileStep;
  ${pointCommon}
  void main() {
    emit(uCellMinLy + (position + 32768.0) * uTileStep);
  }
`;

export const pointFragment = /* glsl */ `
  in vec3 vColor;
  out vec4 outColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    outColor = vec4(vColor * smoothstep(0.5, 0.3, r), 1.0);
  }
`;

export const compositeVertex = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** 1 − e^(−exposure × density): dense areas saturate smoothly, faint ones stay visible. */
export const compositeFragment = /* glsl */ `
  uniform sampler2D tAccum;
  uniform float uExposure;
  in vec2 vUv;
  out vec4 outColor;
  void main() {
    vec3 a = texture(tAccum, vUv).rgb;
    outColor = vec4(vec3(1.0) - exp(-a * uExposure), 1.0);
  }
`;

/**
 * Group rings and markers: drawn after the tone-mapped points, crisp, with normal blending.
 * Size grows with the log of the count; colour says how valuable the best system inside is.
 */
export const ringVertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uBase;
  in float aCount;
  in float aTop;
  in float aHot;
  out vec3 vColor;
  out float vHot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = uBase > 0.0 ? uBase : clamp(10.0 + 5.0 * log(max(aCount, 1.0)) / log(10.0), 10.0, 34.0);
    gl_PointSize = s * uPixelRatio;
    // Best system inside, 100 k CR units: under 1 M grey, under 10 M teal, under 50 M amber, then gold.
    vColor = aTop < 10.0 ? vec3(0.62, 0.66, 0.74)
      : aTop < 100.0 ? vec3(0.3, 0.86, 0.8)
      : aTop < 500.0 ? vec3(1.0, 0.62, 0.22)
      : vec3(1.0, 0.86, 0.35);
    vHot = aHot;
  }
`;

export const ringFragment = /* glsl */ `
  in vec3 vColor;
  in float vHot;
  out vec4 outColor;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float ring = smoothstep(0.34, 0.4, r) * (1.0 - smoothstep(0.46, 0.5, r));
    float fill = 0.1 + 0.18 * vHot;
    float a = max(ring * (0.75 + 0.25 * vHot), fill * (1.0 - smoothstep(0.38, 0.42, r)));
    outColor = vec4(mix(vColor, vec3(1.0), 0.35 * vHot), a);
  }
`;

/**
 * Marker layers (G3): the commander's systems, codex dots. Solid dots with a dark rim so they read
 * over the brightest part of the galaxy; colour and size per marker.
 */
export const markerVertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uMarkerScale;
  in vec3 aColor;
  in float aSize;
  out vec3 vColor;
  out float vRim;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = max(2.0, aSize * uMarkerScale);
    gl_PointSize = s * uPixelRatio;
    vColor = aColor;
    // A dark rim only when the dot is big enough to carry one: from afar thousands of rimmed dots
    // along a route read as a thick black line (G3).
    vRim = s >= 5.0 ? 1.0 : 0.0;
  }
`;

export const markerFragment = /* glsl */ `
  in vec3 vColor;
  in float vRim;
  out vec4 outColor;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    bool rim = vRim > 0.5 && r > 0.36;
    outColor = vec4(rim ? vec3(0.02, 0.02, 0.04) : vColor, rim ? 0.85 : 1.0);
  }
`;

/** GPU picking: each tile point writes (slot << 20 | vertex) as four bytes; 0 means nothing. */
export const pickVertex = /* glsl */ `
  uniform vec3 uCellMinLy;
  uniform float uTileStep;
  uniform float uSize;
  uniform float uViewH;
  uniform uint uSlot;
  uniform float uMinValue;
  uniform float uFilter;
  in float aValue;
  in float aMatch;
  flat out uint vId;
  void main() {
    if (aValue < uMinValue || (uFilter > 1.5 && aMatch < 0.5)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vId = 0u;
      return;
    }
    vec3 g = uCellMinLy + (position + 32768.0) * uTileStep;
    vec4 mv = modelViewMatrix * vec4(g.x, g.y, -g.z, 1.0);
    gl_Position = projectionMatrix * mv;
    // At least 7 px: a dot one pixel wide is not something a hand can hit.
    gl_PointSize = max(7.0, clamp(uSize * uViewH * 2.0 / -mv.z, 1.5, 9.0));
    vId = (uSlot << 20u) | uint(gl_VertexID);
  }
`;

export const pickFragment = /* glsl */ `
  flat in uint vId;
  out vec4 outColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    outColor = vec4(
      float((vId >> 24u) & 255u),
      float((vId >> 16u) & 255u),
      float((vId >> 8u) & 255u),
      float(vId & 255u)
    ) / 255.0;
  }
`;

/**
 * The Milky Way's clouds (galaxyCloudSprites): soft round sprites sized in light years.
 * Close in, a sprite would fill the screen; it fades out before it gets that big, so the clouds thin
 * away around the camera instead of turning into a fog of squares.
 */
export const cloudVertex = /* glsl */ `
  in vec4 tint;
  in vec2 sizeSeed;
  uniform float uScale;
  uniform float uMaxPx;
  uniform float uOpacity;
  uniform float uDust;
  uniform float uFull;
  out vec4 vTint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = sizeSeed.x * uScale / max(1.0, -mv.z);
    // Past a few dozen pixels a sprite stops reading as cloud and starts reading as a blob: let it go.
    float fade = 1.0 - smoothstep(min(36.0, uMaxPx * 0.3), min(110.0, uMaxPx), px);
    gl_PointSize = clamp(px, 1.0, uMaxPx);
    // A sprite smaller than a pixel still lights a whole one: keep its light, not its brightness.
    float sub = px < 1.0 ? px * px : 1.0;
    // The light is shared with the systems' (uOpacity); dust dims whatever is there, at full strength.
    vTint = vec4(tint.rgb, tint.a * fade * sub * (uDust > 0.5 ? min(1.0, uOpacity / uFull) : uOpacity));
  }
`;

export const cloudFragment = /* glsl */ `
  in vec4 vTint;
  out vec4 outColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d2 = dot(p, p) * 4.0;
    if (d2 >= 1.0 || vTint.a <= 0.0) discard;
    float a = exp(-2.4 * d2) * (1.0 - d2);
    outColor = vec4(vTint.rgb, vTint.a * a);
  }
`;
