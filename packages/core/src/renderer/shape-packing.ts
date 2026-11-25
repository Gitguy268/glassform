/**
 * Backend-neutral CPU packing shared by the WebGPU and WebGL2 cores, so both
 * feed their shaders identical shape, submersion, globals and composite data.
 * Moved out of core.ts unchanged.
 */
import {
  getMinimumScale,
  invertMatrix,
  multiplyMatrices,
  scaleOutputMatrix,
  transformPoint,
  type Matrix2D,
} from '../matrix'
import type { Container, Glass } from '../scene'
import {
  estimateShapeGridSubmersions,
  polygonArea,
  resolveNormalGating,
  type ShapeSubmersionEntry,
  type ShapeSubmersionGrid,
  type TransformedShapeBounds,
} from '../sdf'
import type { SpecularWidth, SurfaceProfile } from '../types'
import type { GlassContentRange } from './content-source'
import { getCopiedCssSize, getTextureUvScale } from './dom-content-sync'
import { createEmptyBounds, expandBounds, hasBounds, type BoundsRect } from './metrics'
import { getSortedGlassLayers } from './scene-order'

const MIN_BLEND_SUPPORT_GRID_CELLS = 1
const MAX_BLEND_SUPPORT_GRID_CELLS = 12
const MIN_BLEND_SUPPORT_CELL_SIZE = 1

/** Resolves public specular-width semantics into the shader's device-pixel space. */
export function resolveSpecularWidthPx(specularWidth: SpecularWidth, dpr: number) {
  return specularWidth === 'hairline' ? 1 : specularWidth * dpr
}

/** CPU data for one packed glass shape. */
export type PackedShapeCpuData = ShapeSubmersionEntry & {
  contentRange?: {
    count: number
    start: number
  }
  cornerRadius: number
  cornerSmoothing: number
  halfHeight: number
  halfWidth: number
  inverse: Matrix2D
  minimumScale: number
  submersionCellOffset: number
  submersionGrid: ShapeSubmersionGrid
  worldDevice: Matrix2D
}

/** Result of packing one container's shapes. */
export type PackedContainerShapes = {
  shapes: PackedShapeCpuData[]
  submersionValues: number[]
  bounds: BoundsRect | null
}

/** Maps a public surface profile string to the shader enum value. */
export function getSurfaceProfileIndex(profile: SurfaceProfile) {
  if (profile === 'convex') {
    return 0
  }
  if (profile === 'concave') {
    return 1
  }
  return 2
}

function createDisabledSubmersionGrid(): ShapeSubmersionGrid {
  return {
    cells: [],
    columns: 1,
    rows: 1,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function shapeBoundsFromCorners(corners: TransformedShapeBounds['polygon']): TransformedShapeBounds {
  const bounds = createEmptyBounds()
  for (const corner of corners) {
    expandBounds(bounds, corner.x, corner.y)
  }
  return {
    aabb: bounds,
    area: polygonArea(corners),
    polygon: corners,
  }
}

function gridAxisCellCount(length: number, cellSize: number) {
  return Math.min(
    Math.max(Math.ceil(length / Math.max(cellSize, MIN_BLEND_SUPPORT_CELL_SIZE)), MIN_BLEND_SUPPORT_GRID_CELLS),
    MAX_BLEND_SUPPORT_GRID_CELLS,
  )
}

function shapeSubmersionGridFromMatrix(
  world: Matrix2D,
  width: number,
  height: number,
  cellSize: number,
): ShapeSubmersionGrid {
  const columns = gridAxisCellCount(width, cellSize)
  const rows = gridAxisCellCount(height, cellSize)
  const cellWidth = width / columns
  const cellHeight = height / rows
  const cells: ShapeSubmersionGrid['cells'] = []
  const cellBounds = (minX: number, minY: number, maxX: number, maxY: number) => shapeBoundsFromCorners([
    transformPoint(world, minX, minY),
    transformPoint(world, maxX, minY),
    transformPoint(world, maxX, maxY),
    transformPoint(world, minX, maxY),
  ])

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const minX = column * cellWidth
      const minY = row * cellHeight
      cells.push({
        bounds: cellBounds(minX, minY, minX + cellWidth, minY + cellHeight),
      })
    }
  }

  return {
    cells,
    columns,
    rows,
  }
}

/** Packs a container's visible glass shapes and their blend-support grids. */
export function packContainerShapes(
  container: Container,
  containerTransform: Matrix2D,
  dpr: number,
  getContentRange?: (glass: Glass) => GlassContentRange | null | undefined,
): PackedContainerShapes {
  const glassLayers = getSortedGlassLayers(container)
  const bounds = createEmptyBounds()
  const blendSupportCellSize = Math.max(container.blendSupportGating.cellSize, MIN_BLEND_SUPPORT_CELL_SIZE)
  const packedShapes: PackedShapeCpuData[] = []

  for (const glassLayer of glassLayers) {
    const glass = glassLayer.glass
    if (glass.width <= 0 || glass.height <= 0) {
      continue
    }

    const worldCss = multiplyMatrices(containerTransform, glassLayer.transform)
    const worldDevice = scaleOutputMatrix(worldCss, dpr)
    const inverse = invertMatrix(worldDevice)
    if (!inverse) {
      continue
    }

    const topLeft = transformPoint(worldDevice, 0, 0)
    const topRight = transformPoint(worldDevice, glass.width, 0)
    const bottomLeft = transformPoint(worldDevice, 0, glass.height)
    const bottomRight = transformPoint(worldDevice, glass.width, glass.height)
    const shapeBounds = shapeBoundsFromCorners([topLeft, topRight, bottomRight, bottomLeft])
    expandBounds(bounds, shapeBounds.aabb.minX, shapeBounds.aabb.minY)
    expandBounds(bounds, shapeBounds.aabb.maxX, shapeBounds.aabb.maxY)

    const contentRange = getContentRange?.(glass)
    const halfWidth = glass.width * 0.5
    const halfHeight = glass.height * 0.5
    packedShapes.push({
      bounds: shapeBounds,
      contentRange: contentRange ?? undefined,
      cornerRadius: glass.cornerRadius,
      cornerSmoothing: glass.cornerSmoothing,
      halfHeight,
      halfWidth,
      inverse,
      minimumScale: getMinimumScale(worldDevice),
      submersionCellOffset: 0,
      submersionGrid: createDisabledSubmersionGrid(),
      worldDevice,
    })
  }

  const blendSupportGatingEnabled = container.blendSupportGating.enabled && packedShapes.length > 1
  if (blendSupportGatingEnabled) {
    for (const shape of packedShapes) {
      shape.submersionGrid = shapeSubmersionGridFromMatrix(
        shape.worldDevice,
        shape.halfWidth * 2,
        shape.halfHeight * 2,
        blendSupportCellSize,
      )
    }
  }

  const submersionValues: number[] = []
  for (const shape of packedShapes) {
    const gridValues = blendSupportGatingEnabled
      ? estimateShapeGridSubmersions(packedShapes, shape).values
      : Array.from({ length: shape.submersionGrid.cells.length }, () => 0)
    shape.submersionCellOffset = submersionValues.length
    submersionValues.push(...gridValues)
  }

  return {
    shapes: packedShapes,
    submersionValues,
    bounds: hasBounds(bounds) ? bounds : null,
  }
}

/** ShapeDataLayout values for one packed shape. */
export function shapeDataValues(shape: PackedShapeCpuData) {
  return {
    inverse0: {
      a: shape.inverse.a,
      c: shape.inverse.c,
      e: shape.inverse.e,
      minimumScale: shape.minimumScale,
    },
    inverse1: {
      b: shape.inverse.b,
      d: shape.inverse.d,
      f: shape.inverse.f,
      cornerRadius: shape.cornerRadius,
    },
    geometry: {
      halfWidth: shape.halfWidth,
      halfHeight: shape.halfHeight,
      cornerSmoothing: shape.cornerSmoothing,
    },
    contentRange: {
      start: shape.contentRange?.start ?? 0,
      count: shape.contentRange?.count ?? 0,
    },
    submersionGrid: {
      offset: shape.submersionCellOffset,
      columns: shape.submersionGrid.columns,
      rows: shape.submersionGrid.rows,
    },
  }
}

/** SubmersionCellDataLayout values: four grid cells per struct. */
export function submersionCellValues(values: number[]) {
  const packedCount = Math.ceil(values.length / 4)
  const cells: Array<{ values: { x: number; y: number; z: number; w: number } }> = []
  for (let index = 0; index < Math.max(packedCount, 1); index += 1) {
    const baseIndex = index * 4
    cells.push({
      values: {
        x: values[baseIndex] ?? 0,
        y: values[baseIndex + 1] ?? 0,
        z: values[baseIndex + 2] ?? 0,
        w: values[baseIndex + 3] ?? 0,
      },
    })
  }
  return { packedCount, cells }
}

/** GlobalsLayout values for one container. */
export function globalsValues(container: Container, shapeCount: number, width: number, height: number, dpr: number) {
  const normalGating = resolveNormalGating(container.normalGating)
  const hasBlendCandidates = shapeCount > 1

  return {
    canvas: {
      width,
      height,
    },
    container: {
      opacity: container.opacity,
    },
    shape: {
      smoothing: container.spacing * dpr,
      bezelWidth: container.bezelWidth * dpr,
      shapeCount,
      surfaceProfile: getSurfaceProfileIndex(container.surfaceProfile),
    },
    sdf: {
      normalGatingEnabled: normalGating.enabled && hasBlendCandidates ? 1 : 0,
    },
    sdfParams0: {
      blendSupportGatingEnabled: container.blendSupportGating.enabled && hasBlendCandidates ? 1 : 0,
      smoothUnionAcceleration: clamp(container.smoothUnion.acceleration, 0, 1),
    },
    glass: {
      thickness: container.thickness * dpr,
      displacementFactor: container.displacementFactor,
      ior: container.ior,
      dispersion: container.dispersion,
    },
    content: {
      ior: container.contentIor,
      depth: container.contentDepth * dpr,
    },
    lighting: {
      x: Math.sin(container.lightDirection),
      y: -Math.cos(container.lightDirection),
    },
    specular: {
      strength: container.specularStrength,
      width: resolveSpecularWidthPx(container.specularWidth, dpr),
      sharpness: container.specularSharpness,
      opacity: container.specularOpacity,
    },
    specularSecondary: {
      oppositeStrength: container.oppositeSpecularStrength,
      falloff: container.specularFalloff,
      reflectionOffset: container.reflectionOffset * dpr,
    },
    tint: {
      r: container.tint.r,
      g: container.tint.g,
      b: container.tint.b,
      a: container.tint.a,
    },
    shadow: {
      offsetX: container.shadowOffsetX * dpr,
      offsetY: container.shadowOffsetY * dpr,
      spread: container.shadowSpread * dpr,
      blur: container.shadowBlur * dpr,
    },
    shadowColor: {
      r: container.shadowColor.r,
      g: container.shadowColor.g,
      b: container.shadowColor.b,
      a: container.shadowColor.a,
    },
    debug: {
      displacement: container.debugDisplacement ? 1 : 0,
    },
  }
}

/** Geometry an HTML composite pass needs, independent of texture type. */
export type HtmlCompositeSource = {
  width: number
  height: number
  deviceWidth: number
  deviceHeight: number
  copiedDeviceWidth: number
  copiedDeviceHeight: number
  textureWidth: number
  textureHeight: number
  inverseTransform: Matrix2D | null
  html: { opacity: number }
}

/** HtmlCompositeParamsLayout values for one scene HTML entry. */
export function htmlCompositeValues(entry: HtmlCompositeSource, width: number, height: number) {
  const inverse = entry.inverseTransform!
  return {
    canvas: {
      width,
      height,
      uScale: getTextureUvScale(entry.deviceWidth, entry.width, entry.textureWidth),
      vScale: getTextureUvScale(entry.deviceHeight, entry.height, entry.textureHeight),
    },
    inverse0: {
      a: inverse.a,
      c: inverse.c,
      e: inverse.e,
      copiedWidth: getCopiedCssSize(entry.copiedDeviceWidth, entry.deviceWidth, entry.width),
    },
    inverse1: {
      b: inverse.b,
      d: inverse.d,
      f: inverse.f,
      copiedHeight: getCopiedCssSize(entry.copiedDeviceHeight, entry.deviceHeight, entry.height),
    },
    opacity: {
      value: entry.html.opacity,
    },
  }
}
