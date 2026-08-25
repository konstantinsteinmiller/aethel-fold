export { GrassField, type GrassFieldOptions } from './GrassField'
export {
  GRASS_DETAIL_SETTINGS,
  GRASS_DISTANCES,
  GRASS_LEVELS,
  GRASS_TIER_COUNT,
  grassCullDistance,
  grassLevelIndex,
  grassTierAt,
  liveBladesAt,
  PATCH_SIZE,
  TIER_BLADES,
  tierStart,
  type GrassDetailLevel,
  type GrassDetailSetting
} from './config'
export { buildGrassTier, buildGrassTiers, widthCompensation } from './bladeGeometry'
export { buildChunkPatches, createPatchBuffer, maxPatchesPerChunk, setGrassPalette } from './grassPlacement'
export { GrassMaterial, grassUniforms } from './grassMaterial'
