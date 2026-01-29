# Terrain Phase 2 Implementation: Biome Constants

**Status:** ✅ Complete  
**Date:** January 28, 2026  
**Phase:** 2 of 4+ (from TERRAIN_IMPLEMENTATION_GUIDE.md)

## Overview

Phase 2 establishes the **single source of truth** for biome metadata in the Low-Poly Accurate Earth Terrain system. This phase creates foundational constants and type definitions that will be used by the shader-based biome selection system (Phase 3).

## What Was Implemented

### File Created: `src/terrain/biomeConstants.ts`

This module defines:

1. **BiomeId Enum** - Integer identifiers for each biome type
2. **BiomeDefinition Interface** - Type-safe structure for biome properties
3. **BIOME_DEFINITIONS** - Complete biome metadata (colors, material properties, imagery rules)
4. **BIOME_THRESHOLDS** - Elevation-based boundaries (sea level, grass line, snow line)
5. **LATITUDE_THRESHOLDS** - Latitude-based boundaries (deserts, tropics, polar regions)
6. **Helper Functions** - Utilities for accessing biome data in type-safe ways

## Design Decisions

### 1. Biome Logic Separation

**Key Principle:** TypeScript defines constants; GLSL shader makes biome decisions.

- **TypeScript's Role:**
  - Define biome metadata (colors, roughness, metalness)
  - Define thresholds (elevation, latitude boundaries)
  - Pass uniforms to shader
  - Provide type safety for developers

- **Shader's Role (Phase 3):**
  - Evaluate biome rules per-pixel
  - Determine which biome applies at each position
  - Blend biome colors with optional imagery

This separation ensures:
- ✅ Efficient per-pixel computation on GPU
- ✅ Single function in single place (shader)
- ✅ Easy debugging and visualization
- ✅ Type safety in TypeScript layer

### 2. BiomeId Enum Values

```typescript
export enum BiomeId {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Snow = 4,
  Rock = 5,
}
```

**Critical:** These integer values must match the shader's `#define` directives.

**Why integers?** GLSL doesn't have enums. The shader uses integer IDs for biome selection.

### 3. Imagery Override Rules

Each biome has an `allowsImagery` flag:

| Biome | Allows Imagery | Reason |
|-------|----------------|--------|
| Water | ❌ | Water is always blue, no satellite override |
| Sand | ✅ | Sand textures vary (dunes, rocks, sparse vegetation) |
| Grass | ✅ | Grasslands have varied satellite appearance |
| Forest | ✅ | Forest density and species vary in imagery |
| Snow | ❌ | Snow peaks are always white, no green satellite data |
| Rock | ❌ | Rock faces are bare, no vegetation in imagery |

This prevents MapTiler from showing green vegetation on mountain peaks or sandy beaches on ocean water.

### 4. Color Space

All colors are in **linear RGB** (0-1 range), not sRGB:

```typescript
baseColor: { r: 0.1, g: 0.33, b: 0.56 } // Water
```

**Why?** Three.js expects linear colors for physically-based rendering. The shader converts sRGB imagery to linear before blending.

### 5. Threshold Values

#### Elevation Thresholds (meters)

```typescript
export const BIOME_THRESHOLDS = {
  seaLevel: 0,      // Below = water
  grassLine: 500,   // Above = grass/forest
  snowLine: 3000,   // Above = snow
};
```

These are **starting values** based on Earth averages. They will be refined in Phase 3 based on visual testing.

#### Latitude Thresholds (degrees)

```typescript
export const LATITUDE_THRESHOLDS = {
  desertBoundary: 30,    // Subtropical deserts (±30°)
  tropicsBoundary: 23.5, // Tropic of Cancer/Capricorn
  polarCircle: 66.5,     // Arctic/Antarctic Circle
};
```

These align with Earth's climate zones:
- **±30°** - Subtropical high-pressure belts (Sahara, Arabian, etc.)
- **±23.5°** - Solar tropics (maximum sun angle)
- **±66.5°** - Polar circles (midnight sun/polar night)

## Biome Definitions

### Water (BiomeId.Water = 0)
- **Color:** Deep blue (0.1, 0.33, 0.56)
- **Roughness:** 0.2 (relatively shiny)
- **Allows Imagery:** No
- **Use Case:** Oceans, seas, large lakes

### Sand (BiomeId.Sand = 1)
- **Color:** Sandy tan (0.96, 0.64, 0.38)
- **Roughness:** 0.8 (matte, diffuse)
- **Allows Imagery:** Yes
- **Use Case:** Deserts, beaches, arid regions

### Grass (BiomeId.Grass = 2)
- **Color:** Temperate green (0.18, 0.53, 0.35)
- **Roughness:** 0.7 (slightly matte)
- **Allows Imagery:** Yes
- **Use Case:** Grasslands, plains, prairies

### Forest (BiomeId.Forest = 3)
- **Color:** Dark forest green (0.1, 0.35, 0.17)
- **Roughness:** 0.8 (matte, absorbs light)
- **Allows Imagery:** Yes
- **Use Case:** Dense forests, jungles

### Snow (BiomeId.Snow = 4)
- **Color:** Bright white (0.95, 0.95, 0.95)
- **Roughness:** 0.4 (semi-glossy, reflective)
- **Allows Imagery:** No
- **Use Case:** Alpine peaks, glaciers, polar regions

### Rock (BiomeId.Rock = 5)
- **Color:** Medium gray (0.42, 0.42, 0.42)
- **Roughness:** 0.9 (very matte)
- **Allows Imagery:** No
- **Use Case:** Mountain cliffs, barren slopes

## Helper Functions

### getAllBiomeIds()
Returns all BiomeId values as an array. Useful for iteration.

### getBiomeDefinition(id: BiomeId)
Type-safe accessor for a single biome definition.

### getBiomeDefinitionsArray()
Returns all biome definitions in BiomeId order. Useful for passing arrays to shaders.

## Integration with Phase 3

Phase 3 will:
1. Import these constants in `TerrainMeshBuilder.ts`
2. Pass biome data as shader uniforms:
   ```typescript
   uBiomeColors: { value: [...] }
   uBiomeRoughness: { value: [...] }
   uBiomeAllowsImagery: { value: [...] }
   uSeaLevel: { value: BIOME_THRESHOLDS.seaLevel }
   // etc.
   ```
3. Implement `determineBiome(elevation, latitude)` function in GLSL
4. Implement `getBiomeColor(biomeId, imageryColor)` blending function
5. Replace the current `#include <map_fragment>` with biome-aware coloring

## Type Safety Guarantees

The implementation provides:

✅ **Compile-time type checking** - TypeScript validates all biome properties  
✅ **Exhaustive enum coverage** - All BiomeId values have definitions  
✅ **Immutable constants** - `BIOME_DEFINITIONS` is read-only  
✅ **Range validation** - Colors in 0-1, roughness/metalness in 0-1  
✅ **JSDoc documentation** - All exports have inline documentation

## Testing

Phase 2 includes comprehensive unit tests in `biomeConstants.test.ts`:

- ✅ All biomes have valid definitions
- ✅ Enum-to-definition mapping is complete
- ✅ Color values are in valid range (0-1)
- ✅ Material properties are in valid range (0-1)
- ✅ Thresholds are sensible (sea level < grass line < snow line)
- ✅ Helper functions return correct values
- ✅ Type safety is enforced

## Future Enhancements

### Phase 3+
- Implement shader biome selection using these constants
- Add biome transition blending (smooth elevation gradients)
- Add time-of-day biome color variations

### Optional Improvements
- Make thresholds configurable per-world or per-region
- Add seasonal biome variations (winter grass, autumn forests)
- Add sub-biomes (tropical forest vs temperate forest)

## Files Changed

### New Files
- ✅ `src/terrain/biomeConstants.ts` - Core biome definitions and constants
- ✅ `src/terrain/biomeConstants.test.ts` - Unit tests
- ✅ `TERRAIN_PHASE_2_IMPLEMENTATION.md` - This documentation

### Modified Files
None (Phase 2 is purely additive)

## Validation Checklist

- ✅ BiomeId enum has 6 biomes (Water, Sand, Grass, Forest, Snow, Rock)
- ✅ All biomes have complete BiomeDefinition records
- ✅ Colors are in linear RGB, 0-1 range
- ✅ Material properties (roughness, metalness) are in 0-1 range
- ✅ Elevation thresholds are monotonically increasing
- ✅ Latitude thresholds align with Earth's climate zones
- ✅ Imagery override rules are clearly documented
- ✅ Helper functions provide type-safe access
- ✅ JSDoc comments explain all exports
- ✅ Unit tests verify all invariants

## Next Steps: Phase 3

With biome constants in place, Phase 3 will:

1. Import biome constants into `TerrainMeshBuilder.ts`
2. Add shader uniforms for biome data
3. Implement `determineBiome()` function in GLSL
4. Implement `getBiomeColor()` blending function
5. Replace current imagery-only coloring with biome-aware system
6. Test biome appearance across different elevations and latitudes
7. Refine thresholds based on visual results

**Estimated Time:** 3-4 days (as per TERRAIN_IMPLEMENTATION_GUIDE.md)

## Conclusion

Phase 2 successfully establishes the foundation for biome-based terrain rendering. The constants are:

- **Type-safe** - Full TypeScript type checking
- **Well-documented** - Clear JSDoc comments
- **Testable** - Comprehensive unit test coverage
- **Extensible** - Easy to add new biomes or adjust thresholds
- **Shader-ready** - Designed for efficient GPU uniform passing

The system is ready for Phase 3 implementation: shader-based biome selection.
