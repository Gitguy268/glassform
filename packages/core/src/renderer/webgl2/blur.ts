import { GL_ADAPTIVE_BLUR_SHADER, GL_DOWNSAMPLE_SHADER, GL_UPSAMPLE_SHADER } from '../../shaders-glsl'
import { chooseAdaptiveBlurLevel } from '../adaptive-blur'
import { BlurParamsLayout } from '../shader-layouts'
import { drawFullscreen, GlProgram, type GlBlurChain } from './gl'

const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0]

/** Programs shared by every WebGL2 adaptive blur (format-independent in GL). */
export class GlBlurPrograms {
  readonly downsample: GlProgram
  readonly blur: GlProgram
  readonly upsample: GlProgram
  private readonly horizontal = BlurParamsLayout.createArray()
  private readonly vertical = BlurParamsLayout.createArray()

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.downsample = new GlProgram(gl, GL_DOWNSAMPLE_SHADER)
    this.blur = new GlProgram(gl, GL_ADAPTIVE_BLUR_SHADER)
    this.upsample = new GlProgram(gl, GL_UPSAMPLE_SHADER)
  }

  /**
   * Multi-resolution blur matching renderAdaptiveBlur in ../adaptive-blur.ts.
   * Returns the texture holding the result (the source when radius is 0).
   */
  render(source: WebGLTexture, radiusPx: number, chain: GlBlurChain): WebGLTexture {
    const gl = this.gl
    if (chain.levels.length === 0) {
      return source
    }
    const selection = chooseAdaptiveBlurLevel(radiusPx, chain.levels.length - 1)
    if (selection.skip) {
      return source
    }

    let current = source
    for (let levelIndex = 1; levelIndex <= selection.level; levelIndex += 1) {
      const target = chain.levels[levelIndex].ping
      drawFullscreen(gl, this.downsample, target, { textures: { inputTexture: current }, clear: TRANSPARENT })
      current = target.texture
    }

    const blurLevel = chain.levels[selection.level]
    const radius = Math.max(selection.effectiveRadius, 0)
    BlurParamsLayout.write(this.horizontal, { params: { directionX: 1, directionY: 0, radius } })
    BlurParamsLayout.write(this.vertical, { params: { directionX: 0, directionY: 1, radius } })
    drawFullscreen(gl, this.blur, blurLevel.pong, {
      textures: { inputTexture: current },
      vec4Arrays: { u_blurParams: this.horizontal },
      clear: TRANSPARENT,
    })
    drawFullscreen(gl, this.blur, blurLevel.ping, {
      textures: { inputTexture: blurLevel.pong.texture },
      vec4Arrays: { u_blurParams: this.vertical },
      clear: TRANSPARENT,
    })

    current = blurLevel.ping.texture
    for (let levelIndex = selection.level - 1; levelIndex >= 0; levelIndex -= 1) {
      const target = chain.levels[levelIndex].pong
      drawFullscreen(gl, this.upsample, target, { textures: { inputTexture: current }, clear: TRANSPARENT })
      current = target.texture
    }
    return current
  }

  destroy() {
    this.downsample.destroy()
    this.blur.destroy()
    this.upsample.destroy()
  }
}
