/**
 * GLSL ES 3.00 versions of the WGSL passes in ./shaders.ts, used by the WebGL2
 * backend. Keep the two files in step: every function here mirrors the WGSL
 * function of the same name. The WebGL2-vs-WebGPU parity test renders both.
 *
 * Orientation: every offscreen pass works in top-down texture space, the same
 * as WGSL (uv.y = 0 is the first texture row = top of the image). Only the
 * final present pass into the default framebuffer flips.
 */
import {
  BackdropMetricsBoundsLayout,
  BlurParamsLayout,
  ContentDataLayout,
  GlobalsLayout,
  HtmlCompositeParamsLayout,
  ShapeDataLayout,
} from './renderer/shader-layouts'
import {
  CIRCULAR_CORNER_EXPONENT,
  CORNER_SMOOTHING_EXPONENT_DELTA,
} from './corner-smoothing'

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`

/** Fullscreen triangle without vertex buffers. `flipY` is used only for the final present. */
export const GL_FULLSCREEN_VERTEX = /* glsl */ `${HEADER}
uniform float u_flipY;
out vec2 v_uv;
void main() {
  vec2 position = vec2(
    gl_VertexID == 2 ? 3.0 : -1.0,
    gl_VertexID == 0 ? -3.0 : 1.0
  );
  v_uv = vec2(position.x * 0.5 + 0.5, u_flipY > 0.5 ? 0.5 - position.y * 0.5 : 0.5 + position.y * 0.5);
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAGMENT_PRELUDE = /* glsl */ `${HEADER}
in vec2 v_uv;
out vec4 fragColor;
`

export const GL_DOWNSAMPLE_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
uniform sampler2D inputTexture;
void main() {
  vec2 textureSize = vec2(textureSize(inputTexture, 0));
  vec2 texel = 1.0 / max(textureSize, vec2(1.0));
  vec2 clampedUv = clamp(v_uv, vec2(0.0), vec2(1.0));
  fragColor = (
    textureLod(inputTexture, clampedUv + texel * vec2(-0.5, -0.5), 0.0) +
    textureLod(inputTexture, clampedUv + texel * vec2(0.5, -0.5), 0.0) +
    textureLod(inputTexture, clampedUv + texel * vec2(-0.5, 0.5), 0.0) +
    textureLod(inputTexture, clampedUv + texel * vec2(0.5, 0.5), 0.0)
  ) * 0.25;
}
`

export const GL_UPSAMPLE_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
uniform sampler2D inputTexture;
void main() {
  fragColor = textureLod(inputTexture, v_uv, 0.0);
}
`

export const GL_TEXTURE_BLIT_SHADER = GL_UPSAMPLE_SHADER

export const GL_ADAPTIVE_BLUR_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${BlurParamsLayout.glslStruct('BlurParams')}
${BlurParamsLayout.glslUniform('BlurParams', 'u_blurParams')}
uniform sampler2D inputTexture;

const float ADAPTIVE_BLUR_TAP_RADIUS = 6.0;
const float ADAPTIVE_BLUR_CENTER_WEIGHT = 0.13702282;
const float ADAPTIVE_BLUR_PAIR_OFFSETS[3] = float[3](1.4584295, 3.4039848, 5.3518057);
const float ADAPTIVE_BLUR_PAIR_WEIGHTS[3] = float[3](0.23933733, 0.1394403, 0.052710965);

void main() {
  BlurParams blurParams = loadBlurParams();
  vec2 textureSize = vec2(textureSize(inputTexture, 0));
  vec2 blurStep =
    blurParams.params.xy /
    max(textureSize, vec2(1.0)) *
    (blurParams.params.z / ADAPTIVE_BLUR_TAP_RADIUS);
  vec2 clampedUv = clamp(v_uv, vec2(0.0), vec2(1.0));

  vec4 color = textureLod(inputTexture, clampedUv, 0.0) * ADAPTIVE_BLUR_CENTER_WEIGHT;
  for (int i = 0; i < 3; i++) {
    vec2 offset = blurStep * ADAPTIVE_BLUR_PAIR_OFFSETS[i];
    float weight = ADAPTIVE_BLUR_PAIR_WEIGHTS[i];
    color += (
      textureLod(inputTexture, clamp(clampedUv + offset, vec2(0.0), vec2(1.0)), 0.0) +
      textureLod(inputTexture, clamp(clampedUv - offset, vec2(0.0), vec2(1.0)), 0.0)
    ) * weight;
  }
  fragColor = color;
}
`

const SHADER_SHARED = /* glsl */ `
${GlobalsLayout.glslStruct('Globals')}
${GlobalsLayout.glslUniform('Globals', 'u_globals')}
${ShapeDataLayout.glslStruct('ShapeData')}
${ShapeDataLayout.glslFetch('ShapeData', 'u_shapes')}
uniform highp sampler2D u_submersionCells;

Globals globals;

const float SDF_EPSILON = 0.0001;
const float SDF_GRADIENT_STEP_PX = 1.0;
const float SDF_NORMAL_ANGLE_INV_PI = 0.3183098861837907;
const float SDF_SMOOTH_UNION_DEPTH = 0.25;
const int SDF_BLEND_SUPPORT_KERNEL_RADIUS = 2;
const float DEBUG_DISPLACEMENT_ENCODE_SCALE = 0.01;
const float SPECULAR_DISTANCE_SCALE_FLOOR = 0.25;
const float SPECULAR_EDGE_FEATHER_PX = 1.0;
const float CIRCULAR_CORNER_EXPONENT = ${CIRCULAR_CORNER_EXPONENT.toFixed(8)};
const float CORNER_SMOOTHING_EXPONENT_DELTA = ${CORNER_SMOOTHING_EXPONENT_DELTA.toFixed(8)};

struct SdfSample {
  float distance;
  vec2 gradient;
  float submergedArea;
};

struct SmoothUnionResult {
  float distance;
  float leftWeight;
  float rightWeight;
};

vec2 normalizeSdfGradient(vec2 gradient) {
  float magnitude = length(gradient);
  if (magnitude < SDF_EPSILON) {
    return vec2(0.0, -1.0);
  }
  return gradient / magnitude;
}

SdfSample hardUnion(SdfSample left, SdfSample right) {
  if (left.distance <= right.distance) {
    return left;
  }
  return right;
}

float normalAngleGate(float value) {
  float x = clamp(value, 0.0, 1.0);
  return clamp(x + x * x - x * x * x, 0.0, 1.0);
}

vec2 shapeLocalPos(ShapeData shape, vec2 pos) {
  return vec2(
    shape.inverse0.x * pos.x + shape.inverse0.y * pos.y + shape.inverse0.z,
    shape.inverse1.x * pos.x + shape.inverse1.y * pos.y + shape.inverse1.z
  );
}

float superellipseLength(vec2 v, float exponent) {
  vec2 a = abs(v);
  return pow(pow(a.x, exponent) + pow(a.y, exponent), 1.0 / exponent);
}

float sdSmoothRoundRect(vec2 localPos, vec2 halfSize, float radius, float cornerSmoothing) {
  float cornerLimit = min(halfSize.x, halfSize.y);
  float clampedRadius = min(max(radius, 0.0), cornerLimit);
  vec2 q = abs(localPos) - halfSize + vec2(clampedRadius);
  float maxSmoothingThatFits = radius > SDF_EPSILON
    ? max(cornerLimit / max(radius, SDF_EPSILON) - 1.0, 0.0)
    : 0.0;
  float effectiveSmoothing = min(clamp(cornerSmoothing, 0.0, 1.0), maxSmoothingThatFits);
  float exponent = CIRCULAR_CORNER_EXPONENT + effectiveSmoothing * CORNER_SMOOTHING_EXPONENT_DELTA;
  float cornerDistance = superellipseLength(max(q, vec2(0.0)), exponent);
  return cornerDistance + min(max(q.x, q.y), 0.0) - clampedRadius;
}

float shapeDistanceFromLocal(ShapeData shape, vec2 localPos) {
  vec2 halfSize = shape.geometry.xy;
  float localDistance = sdSmoothRoundRect(localPos - halfSize, halfSize, shape.inverse1.w, shape.geometry.z);
  return localDistance * shape.inverse0.w;
}

float shapeDistance(ShapeData shape, vec2 pos) {
  return shapeDistanceFromLocal(shape, shapeLocalPos(shape, pos));
}

vec2 shapeGradient(ShapeData shape, vec2 pos) {
  float eps = SDF_GRADIENT_STEP_PX;
  return normalizeSdfGradient(vec2(
    shapeDistance(shape, pos + vec2(eps, 0.0)) - shapeDistance(shape, pos - vec2(eps, 0.0)),
    shapeDistance(shape, pos + vec2(0.0, eps)) - shapeDistance(shape, pos - vec2(0.0, eps))
  ));
}

float submersionGridValue(ShapeData shape, int x, int y, int columns, int rows) {
  int clampedX = clamp(x, 0, columns - 1);
  int clampedY = clamp(y, 0, rows - 1);
  int cellIndex = int(round(shape.submersionGrid.x)) + clampedY * columns + clampedX;
  vec4 packedValues = texelFetch(u_submersionCells, ivec2(0, cellIndex / 4), 0);
  int lane = cellIndex - (cellIndex / 4) * 4;
  return lane == 0 ? packedValues.x : lane == 1 ? packedValues.y : lane == 2 ? packedValues.z : packedValues.w;
}

float submersionGridCutoffWeight(float offset, int kernelRadius) {
  float radius = float(kernelRadius) + 0.5;
  float t = clamp((radius - abs(offset)) * 2.0, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float submersionGridGaussianWeight(vec2 offset, int kernelRadius) {
  return exp(-0.5 * dot(offset, offset)) *
    submersionGridCutoffWeight(offset.x, kernelRadius) *
    submersionGridCutoffWeight(offset.y, kernelRadius);
}

float shapeSubmergedArea(ShapeData shape, vec2 localPos) {
  if (globals.sdfParams0.x <= 0.5) {
    return 0.0;
  }

  vec2 size = max(shape.geometry.xy * 2.0, vec2(SDF_EPSILON));
  vec2 uv = clamp(localPos / size, vec2(0.0), vec2(1.0));
  int columns = max(int(round(shape.submersionGrid.y)), 1);
  int rows = max(int(round(shape.submersionGrid.z)), 1);
  vec2 gridCoord = uv * vec2(float(columns), float(rows)) - vec2(0.5);
  ivec2 center = ivec2(floor(gridCoord + vec2(0.5)));
  int kernelRadius = SDF_BLEND_SUPPORT_KERNEL_RADIUS;
  float weightedSum = 0.0;
  float weightSum = 0.0;

  for (int offsetY = -2; offsetY <= 2; offsetY++) {
    for (int offsetX = -2; offsetX <= 2; offsetX++) {
      if (abs(offsetX) > kernelRadius || abs(offsetY) > kernelRadius) {
        continue;
      }
      ivec2 cell = center + ivec2(offsetX, offsetY);
      vec2 offset = vec2(cell) - gridCoord;
      float weight = submersionGridGaussianWeight(offset, kernelRadius);
      weightedSum += submersionGridValue(shape, cell.x, cell.y, columns, rows) * weight;
      weightSum += weight;
    }
  }

  if (weightSum <= SDF_EPSILON) {
    return submersionGridValue(shape, center.x, center.y, columns, rows);
  }
  return weightedSum / weightSum;
}

SdfSample shapeSdfSample(ShapeData shape, vec2 pos) {
  vec2 localPos = shapeLocalPos(shape, pos);
  return SdfSample(
    shapeDistanceFromLocal(shape, localPos),
    shapeGradient(shape, pos),
    shapeSubmergedArea(shape, localPos)
  );
}

float normalGateForSamples(SdfSample left, SdfSample right) {
  float normalAlignment = clamp(dot(left.gradient, right.gradient), -1.0, 1.0);
  float normalGate = 1.0;
  if (globals.sdf.x > 0.5) {
    float normalizedAngle = acos(normalAlignment) * SDF_NORMAL_ANGLE_INV_PI;
    normalGate = normalAngleGate(normalizedAngle);
  }
  return normalGate;
}

float smoothUnionWeight(SdfSample left, SdfSample right, float blendDistance) {
  return clamp(0.5 + 0.5 * (right.distance - left.distance) / max(blendDistance, SDF_EPSILON), 0.0, 1.0);
}

SmoothUnionResult hardUnionResult(float leftDistance, float rightDistance) {
  if (leftDistance <= rightDistance) {
    return SmoothUnionResult(leftDistance, 1.0, 0.0);
  }
  return SmoothUnionResult(rightDistance, 0.0, 1.0);
}

SmoothUnionResult finiteSmoothUnionResult(float leftDistance, float rightDistance, float correction, float correctionDerivative) {
  bool leftIsMin = leftDistance <= rightDistance;
  float leftWeight = leftIsMin ? 1.0 - correctionDerivative : correctionDerivative;
  return SmoothUnionResult(min(leftDistance, rightDistance) - correction, leftWeight, 1.0 - leftWeight);
}

SmoothUnionResult conservativeSmoothUnionResult(float leftDistance, float rightDistance, float blendDistance) {
  float k = max(blendDistance, SDF_EPSILON);
  float progress = clamp(1.0 - abs(leftDistance - rightDistance) / k, 0.0, 1.0);
  if (progress <= SDF_EPSILON) {
    return hardUnionResult(leftDistance, rightDistance);
  }

  float acceleration = clamp(globals.sdfParams0.y, 0.0, 1.0);
  float inverseProgress = 1.0 - progress;
  float remappedProgress = clamp(progress - acceleration * progress * inverseProgress * inverseProgress, 0.0, 1.0);
  float remapDerivative = 1.0 - acceleration * (inverseProgress * inverseProgress - 2.0 * progress * inverseProgress);
  float correction = k * SDF_SMOOTH_UNION_DEPTH * remappedProgress * remappedProgress;
  float derivative = clamp(2.0 * SDF_SMOOTH_UNION_DEPTH * remappedProgress * remapDerivative, 0.0, 1.0);
  return finiteSmoothUnionResult(leftDistance, rightDistance, correction, derivative);
}

SmoothUnionResult smoothUnionResult(float leftDistance, float rightDistance, float blendDistance) {
  return conservativeSmoothUnionResult(leftDistance, rightDistance, blendDistance);
}

float smoothstep01(float value) {
  float x = clamp(value, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

float submergedAreaKScale(float submergedArea) {
  if (globals.sdfParams0.x <= 0.5) {
    return 1.0;
  }
  float area = clamp(submergedArea, 0.0, 1.0);
  return 1.0 - smoothstep01(area);
}

SdfSample smoothUnion(SdfSample left, SdfSample right, float smoothing, float normalGate) {
  float baseBlendDistance = smoothing * normalGate;
  if (baseBlendDistance <= SDF_EPSILON) {
    return hardUnion(left, right);
  }

  float baseH = smoothUnionWeight(left, right, baseBlendDistance);
  float submergedArea = mix(right.submergedArea, left.submergedArea, baseH);
  float kScale = submergedAreaKScale(submergedArea);
  float blendDistance = baseBlendDistance * kScale;
  if (blendDistance <= SDF_EPSILON) {
    return hardUnion(left, right);
  }

  SmoothUnionResult unionResult = smoothUnionResult(left.distance, right.distance, blendDistance);
  return SdfSample(
    unionResult.distance,
    normalizeSdfGradient(left.gradient * unionResult.leftWeight + right.gradient * unionResult.rightWeight),
    submergedArea
  );
}

SdfSample sceneSdfSample(vec2 pos, int shapeCount, float smoothing) {
  SdfSample result = SdfSample(1e5, vec2(0.0, -1.0), 0.0);
  bool found = false;
  for (int i = 0; i < shapeCount; i++) {
    SdfSample nextSample = shapeSdfSample(fetchShapeData(i), pos);
    if (!found) {
      result = nextSample;
      found = true;
    } else {
      float centerNormalGate = normalGateForSamples(result, nextSample);
      result = smoothUnion(result, nextSample, smoothing, centerNormalGate);
    }
  }
  return result;
}

float smootherstep(float value) {
  float x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

float smootherstepDerivative(float value) {
  float x = clamp(value, 0.0, 1.0);
  return 30.0 * x * x * (x * (x - 2.0) + 1.0);
}

vec2 convexSquircle(float x) {
  float u = 1.0 - clamp(x, 0.0, 1.0);
  float inside = max(1.0 - pow(u, 4.0), 0.0001);
  float height = sqrt(inside);
  float derivative = 2.0 * pow(u, 3.0) / sqrt(inside);
  return vec2(height, derivative);
}

vec2 concaveCircle(float x) {
  vec2 squircle = convexSquircle(x);
  return vec2(1.0 - squircle.x, -squircle.y);
}

vec2 evaluateHeightProfile(float profileIndex, float x) {
  if (profileIndex < 0.5) {
    return convexSquircle(x);
  }
  if (profileIndex < 1.5) {
    return concaveCircle(x);
  }
  vec2 convex = convexSquircle(x);
  vec2 concave = concaveCircle(x);
  float blend = smootherstep(x);
  float blendDerivative = smootherstepDerivative(x);
  float height = mix(convex.x, concave.x, blend);
  float derivative = mix(convex.y, concave.y, blend) + (concave.x - convex.x) * blendDerivative;
  return vec2(height, derivative);
}
`

export const GL_DISPLACEMENT_FIELD_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${SHADER_SHARED}

void main() {
  globals = loadGlobals();
  int shapeCount = int(globals.shape.z);
  vec2 fragCoord = v_uv * globals.canvas.xy;
  SdfSample sdfSample = sceneSdfSample(fragCoord, shapeCount, globals.shape.x);
  float distance = sdfSample.distance;
  float fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  float pixelWidth = max(fwidth(distance), 0.75);
  float bezelWidth = max(globals.shape.y, pixelWidth * 2.0);
  float inwardDistance = max(-distance, 0.0);
  float bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  float surfaceDerivative = inwardDistance > bezelWidth
    ? 0.0
    : evaluateHeightProfile(globals.shape.w, bezelProgress).y;
  float clampedSlope = min(surfaceDerivative, tan(1.4835298));
  vec2 surfaceSlope = sdfSample.gradient * clampedSlope;
  fragColor = vec4(surfaceSlope * fillMask, 0.0, fillMask);
}
`

export const GL_SHADOW_MASK_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${SHADER_SHARED}

void main() {
  globals = loadGlobals();
  int shapeCount = int(globals.shape.z);
  vec2 fragCoord = v_uv * globals.canvas.xy;
  vec2 shadowCoord = fragCoord - globals.shadow.xy;
  float distance = sceneSdfSample(shadowCoord, shapeCount, globals.shape.x).distance - globals.shadow.z;
  float pixelWidth = max(fwidth(distance), 0.75);
  float alpha = 1.0 - smoothstep(0.0, pixelWidth, distance);
  fragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`

export const GL_SHADOW_COMPOSITE_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${GlobalsLayout.glslStruct('Globals')}
${GlobalsLayout.glslUniform('Globals', 'u_globals')}
uniform sampler2D sceneTexture;
uniform sampler2D shadowMaskTexture;

void main() {
  Globals globals = loadGlobals();
  vec4 sceneColor = textureLod(sceneTexture, v_uv, 0.0);
  float shadowMask = textureLod(shadowMaskTexture, v_uv, 0.0).a;
  float containerOpacity = clamp(globals.container.x, 0.0, 1.0);
  float shadowOpacity = clamp(shadowMask * globals.shadowColor.a * containerOpacity, 0.0, 1.0);
  vec3 color = mix(sceneColor.rgb, globals.shadowColor.rgb, shadowOpacity);
  fragColor = vec4(color, sceneColor.a);
}
`

export const GL_GLASS_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${SHADER_SHARED}
uniform sampler2D backgroundTextureSharp;
uniform sampler2D backgroundTextureBlurred;
uniform sampler2D glassContentTexture;
uniform sampler2D displacementFieldTexture;
${ContentDataLayout.glslStruct('ContentData')}
${ContentDataLayout.glslFetch('ContentData', 'u_contentEntries')}

vec3 sampleBackgroundSharp(vec2 uv) {
  return textureLod(backgroundTextureSharp, uv, 0.0).rgb;
}

vec3 sampleBackgroundBlurred(vec2 uv) {
  return textureLod(backgroundTextureBlurred, uv, 0.0).rgb;
}

vec2 sampleSurfaceSlope(vec2 uv) {
  vec4 field = textureLod(displacementFieldTexture, uv, 0.0);
  return field.a > SDF_EPSILON ? field.xy / max(field.a, SDF_EPSILON) : vec2(0.0);
}

vec2 contentLocalPos(ContentData content, vec2 glassLocalPos) {
  return vec2(
    content.inverse0.x * glassLocalPos.x + content.inverse0.y * glassLocalPos.y + content.inverse0.z,
    content.inverse1.x * glassLocalPos.x + content.inverse1.y * glassLocalPos.y + content.inverse1.z
  );
}

vec4 sampleGlassContentAtlas(ContentData content, vec2 localPos) {
  vec2 copiedSize = vec2(content.inverse0.w, content.inverse1.w);
  if (
    any(lessThanEqual(copiedSize, vec2(0.0))) ||
    any(lessThanEqual(content.atlasRect.zw, vec2(0.0))) ||
    any(lessThan(localPos, vec2(0.0))) ||
    any(greaterThan(localPos, copiedSize))
  ) {
    return vec4(0.0);
  }
  vec2 atlasUv = content.atlasRect.xy + localPos * content.atlasRect.zw;
  vec4 contentColor = textureLod(glassContentTexture, atlasUv, 0.0);
  return vec4(contentColor.rgb, contentColor.a * clamp(content.opacity.x, 0.0, 1.0));
}

vec4 sampleGlassContentEntry(ContentData content, vec2 glassLocalRed, vec2 glassLocalGreen, vec2 glassLocalBlue, float contentMask) {
  if (contentMask <= 0.0) {
    return vec4(0.0);
  }
  vec4 contentRed = sampleGlassContentAtlas(content, contentLocalPos(content, glassLocalRed));
  vec4 contentGreen = sampleGlassContentAtlas(content, contentLocalPos(content, glassLocalGreen));
  vec4 contentBlue = sampleGlassContentAtlas(content, contentLocalPos(content, glassLocalBlue));
  float alpha = max(contentGreen.a, max(contentRed.a, contentBlue.a)) * contentMask;
  return vec4(vec3(contentRed.r, contentGreen.g, contentBlue.b), alpha);
}

vec2 refractedDisplacement(vec3 surfaceNormal, float ior, float height, float fillMask) {
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), surfaceNormal, 1.0 / max(ior, 1.0001));
  return fillMask <= 0.0 ? vec2(0.0) : ray.xy / max(-ray.z, 0.0001) * height * globals.glass.y;
}

void main() {
  globals = loadGlobals();
  int shapeCount = int(globals.shape.z);
  vec2 fragCoord = v_uv * globals.canvas.xy;
  vec3 background = sampleBackgroundSharp(v_uv);
  float containerOpacity = clamp(globals.container.x, 0.0, 1.0);

  SdfSample sdfSample = sceneSdfSample(fragCoord, shapeCount, globals.shape.x);
  float distance = sdfSample.distance;
  float fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  vec2 gradient = sdfSample.gradient;
  float pixelWidth = max(fwidth(distance), 0.75);
  float specularDistanceUnitsPerPx = max(length(vec2(dFdx(distance), dFdy(distance))), SPECULAR_DISTANCE_SCALE_FLOOR);
  float specularDistancePx = distance / specularDistanceUnitsPerPx;
  float specularInwardDistancePx = max(-specularDistancePx, 0.0);
  float rimWidthPx = max(globals.specular.y, 0.0001);
  float specularOuterMask = 1.0 - smoothstep(0.0, SPECULAR_EDGE_FEATHER_PX, specularDistancePx);
  float specularInnerMask = 1.0 - smoothstep(rimWidthPx, rimWidthPx + SPECULAR_EDGE_FEATHER_PX, specularInwardDistancePx);
  float rimBandMask = specularOuterMask * specularInnerMask;
  vec2 rimNormal = gradient;
  vec2 lightDir = normalize(dot(globals.lighting.xy, globals.lighting.xy) > 0.0001 ? globals.lighting.xy : vec2(1.0, 0.0));
  vec2 mirroredLightDir = -lightDir;

  float bezelWidth = max(globals.shape.y, pixelWidth * 2.0);
  float inwardDistance = max(-distance, 0.0);
  float bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  vec2 profileResult = evaluateHeightProfile(globals.shape.w, bezelProgress);
  float profileHeight = profileResult.x * bezelWidth;
  float flatHeight = evaluateHeightProfile(globals.shape.w, 1.0).x * bezelWidth;
  float surfaceHeight = globals.glass.x + (inwardDistance > bezelWidth ? flatHeight : profileHeight);
  vec2 surfaceSlope = sampleSurfaceSlope(v_uv);

  vec3 surfaceNormal = normalize(vec3(surfaceSlope, 1.0));
  float dispersion = max(globals.glass.w, 0.0);
  float baseIor = max(globals.glass.z, 1.0001);
  vec2 displacementPxRed = refractedDisplacement(surfaceNormal, baseIor + dispersion, surfaceHeight, fillMask);
  vec2 displacementPxGreen = refractedDisplacement(surfaceNormal, baseIor, surfaceHeight, fillMask);
  vec2 displacementPxBlue = refractedDisplacement(surfaceNormal, baseIor - dispersion, surfaceHeight, fillMask);
  if (globals.debug.x > 0.5) {
    vec2 debugDisplacement = displacementPxGreen * DEBUG_DISPLACEMENT_ENCODE_SCALE + vec2(0.5);
    vec3 debugColor = mix(background, vec3(debugDisplacement, 0.0), fillMask);
    fragColor = vec4(mix(background, debugColor, containerOpacity), 1.0);
    return;
  }
  float contentBaseIor = max(globals.content.x, 1.0001);
  vec2 contentDisplacementPxRed = refractedDisplacement(surfaceNormal, contentBaseIor + dispersion, globals.content.y, fillMask);
  vec2 contentDisplacementPxGreen = refractedDisplacement(surfaceNormal, contentBaseIor, globals.content.y, fillMask);
  vec2 contentDisplacementPxBlue = refractedDisplacement(surfaceNormal, contentBaseIor - dispersion, globals.content.y, fillMask);
  vec2 refractedUvRed = v_uv + displacementPxRed / globals.canvas.xy;
  vec2 refractedUvGreen = v_uv + displacementPxGreen / globals.canvas.xy;
  vec2 refractedUvBlue = v_uv + displacementPxBlue / globals.canvas.xy;
  vec3 refractedColor = vec3(
    sampleBackgroundBlurred(refractedUvRed).r,
    sampleBackgroundBlurred(refractedUvGreen).g,
    sampleBackgroundBlurred(refractedUvBlue).b
  );
  vec2 reflectedUv = v_uv + rimNormal * globals.specularSecondary.z / globals.canvas.xy;
  vec3 reflectedColor = sampleBackgroundBlurred(reflectedUv);
  vec3 glass = mix(refractedColor, globals.tint.rgb, globals.tint.a);
  float refractedLuma = dot(refractedColor, vec3(0.2126, 0.7152, 0.0722));
  float reflectedLuma = dot(reflectedColor, vec3(0.2126, 0.7152, 0.0722));

  float reflectionPresence = smoothstep(0.2, 0.85, reflectedLuma);
  float refractionAcceptance = 1.0 - smoothstep(0.35, 0.85, refractedLuma);
  float reflectionBlend = reflectionPresence * refractionAcceptance;
  vec3 edgeSpecularColor = mix(refractedColor, reflectedColor, reflectionBlend);

  vec3 glassInterior = glass;
  for (int i = 0; i < shapeCount; i++) {
    ShapeData shape = fetchShapeData(i);
    int contentStart = int(shape.contentRange.x);
    int contentCount = int(shape.contentRange.y);
    float shapeDistanceAtFrag = shapeDistance(shape, fragCoord);
    float contentBand = max(globals.shape.x, pixelWidth);
    float contentMask = 1.0 - smoothstep(contentBand, contentBand + pixelWidth, shapeDistanceAtFrag);
    vec2 glassLocalRed = shapeLocalPos(shape, fragCoord + contentDisplacementPxRed);
    vec2 glassLocalGreen = shapeLocalPos(shape, fragCoord + contentDisplacementPxGreen);
    vec2 glassLocalBlue = shapeLocalPos(shape, fragCoord + contentDisplacementPxBlue);
    for (int contentOffset = 0; contentOffset < contentCount; contentOffset++) {
      vec4 contentLayer = sampleGlassContentEntry(
        fetchContentData(contentStart + contentOffset),
        glassLocalRed,
        glassLocalGreen,
        glassLocalBlue,
        contentMask
      );
      glassInterior = mix(glassInterior, contentLayer.rgb, contentLayer.a);
    }
  }

  float primaryBandProgress = clamp(specularInwardDistancePx / max(rimWidthPx, SPECULAR_EDGE_FEATHER_PX), 0.0, 1.0);
  float oppositeBandProgress = primaryBandProgress;
  float primaryStrength = globals.specular.x - globals.specularSecondary.y * primaryBandProgress * primaryBandProgress;
  float oppositeStrength = globals.specularSecondary.x - globals.specularSecondary.y * oppositeBandProgress * oppositeBandProgress;
  float oppositeRimBandMask = rimBandMask;
  float rimSpecular = pow(max(dot(rimNormal, lightDir), 0.0), globals.specular.z);
  float mirroredRimSpecular = pow(max(dot(rimNormal, mirroredLightDir), 0.0), globals.specular.z);
  float primarySpecularOpacity = clamp(rimSpecular * primaryStrength, 0.0, 1.0);
  float oppositeSpecularOpacity = clamp(mirroredRimSpecular * oppositeStrength, 0.0, 1.0);
  float combinedRimSpecularOpacity = clamp(
    primarySpecularOpacity * rimBandMask + oppositeSpecularOpacity * oppositeRimBandMask,
    0.0,
    1.0
  );
  float whiteSpecularOpacity = combinedRimSpecularOpacity * globals.specular.w;
  float coloredEdgeOpacity = combinedRimSpecularOpacity;
  vec3 whiteSpecular = vec3(1.0) * whiteSpecularOpacity;

  vec3 color = background;
  if (fillMask > 0.0) {
    color = mix(color, glassInterior, fillMask);
    color = mix(color, edgeSpecularColor, coloredEdgeOpacity);
    color = color + whiteSpecular;
  }
  fragColor = vec4(mix(background, color, containerOpacity), 1.0);
}
`

export const GL_METRICS_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${SHADER_SHARED}
${BackdropMetricsBoundsLayout.glslStruct('MetricsBounds')}
${BackdropMetricsBoundsLayout.glslUniform('MetricsBounds', 'u_metricsBounds')}
uniform sampler2D blurredBackdrop;

void main() {
  globals = loadGlobals();
  MetricsBounds metricsBounds = loadMetricsBounds();
  int shapeCount = int(globals.shape.z);
  vec2 positionPx = mix(metricsBounds.bounds.xy, metricsBounds.bounds.zw, v_uv);
  bool insideCanvas =
    all(greaterThanEqual(positionPx, vec2(0.0))) &&
    all(lessThanEqual(positionPx, globals.canvas.xy));
  float distance = sceneSdfSample(positionPx, shapeCount, globals.shape.x).distance;
  bool isInterior = insideCanvas && distance <= -globals.shape.y;
  vec3 color = textureLod(blurredBackdrop, positionPx / globals.canvas.xy, 0.0).rgb;
  fragColor = vec4(color, isInterior ? 1.0 : 0.0);
}
`

export const GL_HTML_COMPOSITE_SHADER = /* glsl */ `${FRAGMENT_PRELUDE}
${HtmlCompositeParamsLayout.glslStruct('HtmlCompositeParams')}
${HtmlCompositeParamsLayout.glslUniform('HtmlCompositeParams', 'u_params')}
uniform sampler2D sceneTexture;
uniform sampler2D htmlTexture;

void main() {
  HtmlCompositeParams params = loadHtmlCompositeParams();
  vec4 sceneColor = textureLod(sceneTexture, v_uv, 0.0);
  vec2 fragCoord = v_uv * params.canvas.xy;
  vec2 localPos = vec2(
    params.inverse0.x * fragCoord.x + params.inverse0.y * fragCoord.y + params.inverse0.z,
    params.inverse1.x * fragCoord.x + params.inverse1.y * fragCoord.y + params.inverse1.z
  );
  vec2 copiedSize = vec2(params.inverse0.w, params.inverse1.w);
  if (
    any(lessThanEqual(params.canvas.zw, vec2(0.0))) ||
    any(lessThanEqual(copiedSize, vec2(0.0))) ||
    any(lessThan(localPos, vec2(0.0))) ||
    any(greaterThan(localPos, copiedSize))
  ) {
    fragColor = sceneColor;
    return;
  }
  vec4 htmlColor = textureLod(htmlTexture, localPos * params.canvas.zw, 0.0);
  float htmlAlpha = htmlColor.a * clamp(params.opacity.x, 0.0, 1.0);
  fragColor = vec4(mix(sceneColor.rgb, htmlColor.rgb, htmlAlpha), 1.0);
}
`

/** Shared by fragment passes that need the struct sources, for tests. */
export const GL_SHADER_SOURCES = {
  downsample: GL_DOWNSAMPLE_SHADER,
  upsample: GL_UPSAMPLE_SHADER,
  blur: GL_ADAPTIVE_BLUR_SHADER,
  displacement: GL_DISPLACEMENT_FIELD_SHADER,
  shadowMask: GL_SHADOW_MASK_SHADER,
  shadowComposite: GL_SHADOW_COMPOSITE_SHADER,
  glass: GL_GLASS_SHADER,
  metrics: GL_METRICS_SHADER,
  htmlComposite: GL_HTML_COMPOSITE_SHADER,
} as const
