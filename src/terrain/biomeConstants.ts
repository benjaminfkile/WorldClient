// src/terrain/biomeConstants.ts

/**
 * Biome identifiers. These match the integer values used in the shader.
 * CRITICAL: Do not change enum values without updating shader code.
 */
export enum BiomeId {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Snow = 4,
  Rock = 5,
}

/**
 * Biome metadata defining visual appearance and behavior.
 * This is the single source of truth for biome properties.
 */
export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  baseColor: { r: number; g: number; b: number }; // RGB in 0-1 range
  roughness: number; // PBR material roughness (0 = mirror, 1 = matte)
  metalness: number; // PBR material metalness (0 = dielectric, 1 = metal)
  allowsImagery: boolean; // Can MapTiler imagery override/tint this biome?
}

/**
 * Complete biome definitions.
 * These values are passed to the shader as uniforms.
 */
export const BIOME_DEFINITIONS: Record<BiomeId, BiomeDefinition> = {
  [BiomeId.Water]: {
    id: BiomeId.Water,
    name: 'Water',
    baseColor: { r: 0.1, g: 0.33, b: 0.56 }, // Deep blue
    roughness: 0.2, // Relatively smooth/shiny
    metalness: 0.0,
    allowsImagery: false, // Water is always water, no satellite override
  },
  [BiomeId.Sand]: {
    id: BiomeId.Sand,
    name: 'Sand/Desert',
    baseColor: { r: 0.96, g: 0.64, b: 0.38 }, // Sandy tan
    roughness: 0.8, // Matte, diffuse
    metalness: 0.0,
    allowsImagery: true, // Sand textures can vary (dunes, rocks, sparse vegetation)
  },
  [BiomeId.Grass]: {
    id: BiomeId.Grass,
    name: 'Grassland',
    baseColor: { r: 0.18, g: 0.53, b: 0.35 }, // Temperate green
    roughness: 0.7, // Slightly matte
    metalness: 0.0,
    allowsImagery: true, // Grasslands have varied satellite appearance
  },
  [BiomeId.Forest]: {
    id: BiomeId.Forest,
    name: 'Forest',
    baseColor: { r: 0.1, g: 0.35, b: 0.17 }, // Dark forest green
    roughness: 0.8, // Matte, absorbs light
    metalness: 0.0,
    allowsImagery: true, // Forest density and species vary in imagery
  },
  [BiomeId.Snow]: {
    id: BiomeId.Snow,
    name: 'Snow/Alpine',
    baseColor: { r: 0.95, g: 0.95, b: 0.95 }, // Bright white
    roughness: 0.4, // Semi-glossy (snow can be reflective)
    metalness: 0.0,
    allowsImagery: false, // Snow peaks are always white, no green satellite data
  },
  [BiomeId.Rock]: {
    id: BiomeId.Rock,
    name: 'Rock/Mountain',
    baseColor: { r: 0.42, g: 0.42, b: 0.42 }, // Medium gray
    roughness: 0.9, // Very matte
    metalness: 0.0,
    allowsImagery: false, // Rock faces are bare, no vegetation in imagery
  },
};

/**
 * Elevation-based biome thresholds (in meters above sea level).
 * These control the vertical distribution of biomes.
 */
export const BIOME_THRESHOLDS = {
  /** Elevation below this is water (oceans, lakes) */
  seaLevel: 0,
  
  /** Elevation above this transitions from sand to grass/forest */
  grassLine: 500,
  
  /** Elevation above this is snow (alpine, glaciers) */
  snowLine: 3000,
};

/**
 * Latitude-based biome thresholds (in degrees, -90 to 90).
 * These control the horizontal distribution of biomes.
 */
export const LATITUDE_THRESHOLDS = {
  /** Subtropical deserts typically form around ±30° */
  desertBoundary: 30,
  
  /** Tropic of Cancer/Capricorn (±23.5°) */
  tropicsBoundary: 23.5,
  
  /** Arctic/Antarctic Circle (±66.5°) - polar regions beyond this */
  polarCircle: 66.5,
};

/**
 * Get the list of all biome IDs in order.
 * Useful for iterating over biomes in shader uniform setup.
 */
export function getAllBiomeIds(): BiomeId[] {
  return [
    BiomeId.Water,
    BiomeId.Sand,
    BiomeId.Grass,
    BiomeId.Forest,
    BiomeId.Snow,
    BiomeId.Rock,
  ];
}

/**
 * Get biome definition by ID.
 */
export function getBiomeDefinition(id: BiomeId): BiomeDefinition {
  return BIOME_DEFINITIONS[id];
}

/**
 * Get all biome definitions as an array, ordered by BiomeId.
 * Useful for passing to shaders as uniform arrays.
 */
export function getBiomeDefinitionsArray(): BiomeDefinition[] {
  return getAllBiomeIds().map(id => BIOME_DEFINITIONS[id]);
}
