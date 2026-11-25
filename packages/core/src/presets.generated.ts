// Written by fidelity/tune.mjs from native SwiftUI captures. Empty until a
// tuning run has been done; materials.ts then falls back to its hand presets.
import type { MaterialParameters } from './materials'

export const GENERATED_PRESETS: Partial<Record<string, Partial<MaterialParameters>>> = {}

export const GENERATED_PRESETS_INFO: { date: string; macOS: string; scores: Record<string, number> } | null = null
