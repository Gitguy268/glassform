import { GL_FULLSCREEN_VERTEX } from '../../shaders-glsl'

/** Color formats used for WebGL2 render targets. */
export type GlTargetFormat = 'rgba8' | 'rgba16f'

/** A texture with a framebuffer that renders into it. */
export type GlTarget = {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
  format: GlTargetFormat
}

/** One level of an adaptive blur chain (mirrors AdaptiveBlurTargetLevel). */
export type GlBlurLevel = {
  ping: GlTarget
  pong: GlTarget
  width: number
  height: number
}

/** Half-resolution chain down to 1x1 (mirrors AdaptiveBlurTargetChain). */
export type GlBlurChain = {
  format: GlTargetFormat
  levels: GlBlurLevel[]
}

/** Context options matching the WebGPU canvas configuration (`alphaMode: 'opaque'`). */
export const GL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
}

/** Enables the extensions the WebGL2 backend needs, or throws. */
export function enableGlExtensions(gl: WebGL2RenderingContext) {
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    throw new Error('WebGL2 float render targets (EXT_color_buffer_float) are not available.')
  }
}

function setTextureParams(gl: WebGL2RenderingContext, filter: number) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

/** Allocates an empty RGBA texture with linear filtering. */
export function createColorTexture(gl: WebGL2RenderingContext, width: number, height: number, format: GlTargetFormat = 'rgba8') {
  const texture = gl.createTexture()
  if (!texture) {
    throw new Error('Unable to create a WebGL texture.')
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  if (format === 'rgba16f') {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height)
  } else {
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height)
  }
  setTextureParams(gl, gl.LINEAR)
  return texture
}

/** Creates a render target (texture + framebuffer). */
export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, format: GlTargetFormat = 'rgba8'): GlTarget {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const texture = createColorTexture(gl, w, h, format)
  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) {
    throw new Error('Unable to create a WebGL framebuffer.')
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { texture, framebuffer, width: w, height: h, format }
}

/** Deletes a render target. */
export function destroyTarget(gl: WebGL2RenderingContext, target: GlTarget | null | undefined) {
  if (!target) {
    return
  }
  gl.deleteFramebuffer(target.framebuffer)
  gl.deleteTexture(target.texture)
}

/** Creates a full-size-to-1px chain of ping/pong targets. */
export function createBlurChain(gl: WebGL2RenderingContext, format: GlTargetFormat, width: number, height: number): GlBlurChain {
  const levels: GlBlurLevel[] = []
  let levelWidth = Math.max(Math.floor(width), 1)
  let levelHeight = Math.max(Math.floor(height), 1)
  while (true) {
    levels.push({
      ping: createTarget(gl, levelWidth, levelHeight, format),
      pong: createTarget(gl, levelWidth, levelHeight, format),
      width: levelWidth,
      height: levelHeight,
    })
    if (levelWidth === 1 && levelHeight === 1) {
      break
    }
    levelWidth = Math.max(Math.ceil(levelWidth / 2), 1)
    levelHeight = Math.max(Math.ceil(levelHeight / 2), 1)
  }
  return { format, levels }
}

/** Deletes every target in a blur chain. */
export function destroyBlurChain(gl: WebGL2RenderingContext, chain: GlBlurChain | null | undefined) {
  for (const level of chain?.levels ?? []) {
    destroyTarget(gl, level.ping)
    destroyTarget(gl, level.pong)
  }
}

/** Compiled program with cached uniform locations. */
export class GlProgram {
  readonly program: WebGLProgram
  private readonly locations = new Map<string, WebGLUniformLocation | null>()

  constructor(private readonly gl: WebGL2RenderingContext, fragmentSource: string, vertexSource = GL_FULLSCREEN_VERTEX) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) {
      throw new Error('Unable to create a WebGL program.')
    }
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`WebGL program link failed: ${log}`)
    }
    this.program = program
  }

  location(name: string) {
    if (!this.locations.has(name)) {
      this.locations.set(name, this.gl.getUniformLocation(this.program, name))
    }
    return this.locations.get(name) ?? null
  }

  destroy() {
    this.gl.deleteProgram(this.program)
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Unable to create a WebGL shader.')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    const numbered = source.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n')
    throw new Error(`WebGL shader compile failed: ${log}\n${numbered}`)
  }
  return shader
}

/** Inputs for one fullscreen draw. */
export type GlPassInputs = {
  /** Sampler uniform name -> texture. */
  textures?: Record<string, WebGLTexture | null>
  /** vec4-array uniform name -> packed floats. */
  vec4Arrays?: Record<string, Float32Array>
  /** Flip vertically (only for the final present into the default framebuffer). */
  flipY?: boolean
  /** Clear the target to this color before drawing. */
  clear?: [number, number, number, number]
}

/** Shared empty vertex array for attribute-less fullscreen triangles. */
const vaoCache = new WeakMap<WebGL2RenderingContext, WebGLVertexArrayObject>()

/** Draws a fullscreen triangle with `program` into `target` (null = default framebuffer). */
export function drawFullscreen(
  gl: WebGL2RenderingContext,
  program: GlProgram,
  target: GlTarget | null,
  inputs: GlPassInputs,
  viewport?: { x: number; y: number; width: number; height: number },
) {
  let vao = vaoCache.get(gl)
  if (!vao) {
    vao = gl.createVertexArray() ?? undefined
    if (vao) {
      vaoCache.set(gl, vao)
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null)
  if (viewport) {
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height)
  } else if (target) {
    gl.viewport(0, 0, target.width, target.height)
  } else {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  }
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.SCISSOR_TEST)
  if (inputs.clear) {
    gl.clearColor(...inputs.clear)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  gl.useProgram(program.program)
  gl.bindVertexArray(vao ?? null)
  gl.uniform1f(program.location('u_flipY'), inputs.flipY ? 1 : 0)
  let unit = 0
  for (const [name, texture] of Object.entries(inputs.textures ?? {})) {
    const location = program.location(name)
    if (!location) {
      continue
    }
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(location, unit)
    unit += 1
  }
  for (const [name, data] of Object.entries(inputs.vec4Arrays ?? {})) {
    const location = program.location(name)
    if (location) {
      gl.uniform4fv(location, data)
    }
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)
}

/**
 * RGBA32F texture holding an array of vec4-lane structs, one struct per row
 * and one lane per texel. Replaces WGSL storage buffers.
 */
export class GlDataTexture {
  texture: WebGLTexture
  private rows = 0

  constructor(private readonly gl: WebGL2RenderingContext, private readonly lanes: number) {
    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('Unable to create a WebGL data texture.')
    }
    this.texture = texture
    this.upload(new Float32Array(lanes * 4), 1)
  }

  /** Uploads `count` structs from `data` (each `lanes * 4` floats). */
  upload(data: Float32Array, count: number) {
    const gl = this.gl
    const rows = Math.max(count, 1)
    const needed = rows * this.lanes * 4
    const source = data.length >= needed ? data.subarray(0, needed) : padded(data, needed)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (rows !== this.rows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.lanes, rows, 0, gl.RGBA, gl.FLOAT, source)
      setTextureParams(gl, gl.NEAREST)
      this.rows = rows
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.lanes, rows, gl.RGBA, gl.FLOAT, source)
    }
  }

  destroy() {
    this.gl.deleteTexture(this.texture)
  }
}

function padded(data: Float32Array, length: number) {
  const out = new Float32Array(length)
  out.set(data.subarray(0, Math.min(data.length, length)))
  return out
}

/** Uploads an image/canvas/video into a texture region (top row first, no flip). */
export function uploadImage(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  source: TexImageSource,
  x = 0,
  y = 0,
) {
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source)
}
