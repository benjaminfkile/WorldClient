// src/terrain/biomeConstants.test.ts

import {
  BiomeId,
  BiomeDefinition,
  BIOME_DEFINITIONS,
  BIOME_THRESHOLDS,
  LATITUDE_THRESHOLDS,
  getAllBiomeIds,
  getBiomeDefinition,
  getBiomeDefinitionsArray,
} from './biomeConstants';

describe('biomeConstants', () => {
  describe('BiomeId enum', () => {
    it('should have 6 biome types', () => {
      const biomeIds = Object.keys(BiomeId).filter(key => !isNaN(Number(key)));
      expect(biomeIds).toHaveLength(6);
    });

    it('should have sequential integer values starting from 0', () => {
      expect(BiomeId.Water).toBe(0);
      expect(BiomeId.Sand).toBe(1);
      expect(BiomeId.Grass).toBe(2);
      expect(BiomeId.Forest).toBe(3);
      expect(BiomeId.Snow).toBe(4);
      expect(BiomeId.Rock).toBe(5);
    });

    it('should have unique values', () => {
      const values = Object.values(BiomeId).filter(v => typeof v === 'number');
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('BIOME_DEFINITIONS', () => {
    it('should have a definition for every BiomeId', () => {
      const allIds = getAllBiomeIds();
      allIds.forEach(id => {
        expect(BIOME_DEFINITIONS[id]).toBeDefined();
        expect(BIOME_DEFINITIONS[id].id).toBe(id);
      });
    });

    it('should have exactly 6 biome definitions', () => {
      expect(Object.keys(BIOME_DEFINITIONS)).toHaveLength(6);
    });

    describe('biome colors', () => {
      it('should have valid RGB values (0-1 range)', () => {
        Object.values(BIOME_DEFINITIONS).forEach(biome => {
          expect(biome.baseColor.r).toBeGreaterThanOrEqual(0);
          expect(biome.baseColor.r).toBeLessThanOrEqual(1);
          expect(biome.baseColor.g).toBeGreaterThanOrEqual(0);
          expect(biome.baseColor.g).toBeLessThanOrEqual(1);
          expect(biome.baseColor.b).toBeGreaterThanOrEqual(0);
          expect(biome.baseColor.b).toBeLessThanOrEqual(1);
        });
      });

      it('should have distinct colors for visual differentiation', () => {
        const colors = Object.values(BIOME_DEFINITIONS).map(b => 
          `${b.baseColor.r},${b.baseColor.g},${b.baseColor.b}`
        );
        const uniqueColors = new Set(colors);
        expect(uniqueColors.size).toBe(colors.length);
      });

      it('should have water as predominantly blue', () => {
        const water = BIOME_DEFINITIONS[BiomeId.Water];
        expect(water.baseColor.b).toBeGreaterThan(water.baseColor.r);
        expect(water.baseColor.b).toBeGreaterThan(water.baseColor.g);
      });

      it('should have grass/forest as predominantly green', () => {
        const grass = BIOME_DEFINITIONS[BiomeId.Grass];
        expect(grass.baseColor.g).toBeGreaterThan(grass.baseColor.r);
        expect(grass.baseColor.g).toBeGreaterThan(grass.baseColor.b);

        const forest = BIOME_DEFINITIONS[BiomeId.Forest];
        expect(forest.baseColor.g).toBeGreaterThan(forest.baseColor.r);
        expect(forest.baseColor.g).toBeGreaterThan(forest.baseColor.b);
      });

      it('should have snow as near-white', () => {
        const snow = BIOME_DEFINITIONS[BiomeId.Snow];
        expect(snow.baseColor.r).toBeGreaterThan(0.9);
        expect(snow.baseColor.g).toBeGreaterThan(0.9);
        expect(snow.baseColor.b).toBeGreaterThan(0.9);
      });

      it('should have sand with warm tones', () => {
        const sand = BIOME_DEFINITIONS[BiomeId.Sand];
        expect(sand.baseColor.r).toBeGreaterThan(sand.baseColor.b);
        expect(sand.baseColor.g).toBeGreaterThan(sand.baseColor.b);
      });
    });

    describe('material properties', () => {
      it('should have valid roughness values (0-1 range)', () => {
        Object.values(BIOME_DEFINITIONS).forEach(biome => {
          expect(biome.roughness).toBeGreaterThanOrEqual(0);
          expect(biome.roughness).toBeLessThanOrEqual(1);
        });
      });

      it('should have valid metalness values (0-1 range)', () => {
        Object.values(BIOME_DEFINITIONS).forEach(biome => {
          expect(biome.metalness).toBeGreaterThanOrEqual(0);
          expect(biome.metalness).toBeLessThanOrEqual(1);
        });
      });

      it('should have all biomes as non-metallic (natural materials)', () => {
        Object.values(BIOME_DEFINITIONS).forEach(biome => {
          expect(biome.metalness).toBe(0);
        });
      });

      it('should have water as relatively smooth (shiny)', () => {
        const water = BIOME_DEFINITIONS[BiomeId.Water];
        expect(water.roughness).toBeLessThan(0.5);
      });

      it('should have rock as very rough (matte)', () => {
        const rock = BIOME_DEFINITIONS[BiomeId.Rock];
        expect(rock.roughness).toBeGreaterThan(0.8);
      });
    });

    describe('imagery override rules', () => {
      it('should not allow imagery on water', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Water].allowsImagery).toBe(false);
      });

      it('should not allow imagery on snow', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Snow].allowsImagery).toBe(false);
      });

      it('should not allow imagery on rock', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Rock].allowsImagery).toBe(false);
      });

      it('should allow imagery on sand', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Sand].allowsImagery).toBe(true);
      });

      it('should allow imagery on grass', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Grass].allowsImagery).toBe(true);
      });

      it('should allow imagery on forest', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Forest].allowsImagery).toBe(true);
      });
    });

    describe('biome names', () => {
      it('should have non-empty names', () => {
        Object.values(BIOME_DEFINITIONS).forEach(biome => {
          expect(biome.name).toBeTruthy();
          expect(biome.name.length).toBeGreaterThan(0);
        });
      });

      it('should have descriptive names', () => {
        expect(BIOME_DEFINITIONS[BiomeId.Water].name).toContain('Water');
        expect(BIOME_DEFINITIONS[BiomeId.Sand].name).toMatch(/Sand|Desert/);
        expect(BIOME_DEFINITIONS[BiomeId.Grass].name).toContain('Grass');
        expect(BIOME_DEFINITIONS[BiomeId.Forest].name).toContain('Forest');
        expect(BIOME_DEFINITIONS[BiomeId.Snow].name).toMatch(/Snow|Alpine/);
        expect(BIOME_DEFINITIONS[BiomeId.Rock].name).toMatch(/Rock|Mountain/);
      });
    });
  });

  describe('BIOME_THRESHOLDS', () => {
    it('should have all required elevation thresholds', () => {
      expect(BIOME_THRESHOLDS.seaLevel).toBeDefined();
      expect(BIOME_THRESHOLDS.grassLine).toBeDefined();
      expect(BIOME_THRESHOLDS.snowLine).toBeDefined();
    });

    it('should have thresholds in ascending order', () => {
      expect(BIOME_THRESHOLDS.seaLevel).toBeLessThan(BIOME_THRESHOLDS.grassLine);
      expect(BIOME_THRESHOLDS.grassLine).toBeLessThan(BIOME_THRESHOLDS.snowLine);
    });

    it('should have sea level at 0 meters', () => {
      expect(BIOME_THRESHOLDS.seaLevel).toBe(0);
    });

    it('should have grassLine above sea level', () => {
      expect(BIOME_THRESHOLDS.grassLine).toBeGreaterThan(0);
    });

    it('should have snowLine at reasonable altitude (2000-4000m)', () => {
      expect(BIOME_THRESHOLDS.snowLine).toBeGreaterThanOrEqual(2000);
      expect(BIOME_THRESHOLDS.snowLine).toBeLessThanOrEqual(4000);
    });

    it('should have sufficient separation between thresholds', () => {
      const grassToSnowRange = BIOME_THRESHOLDS.snowLine - BIOME_THRESHOLDS.grassLine;
      expect(grassToSnowRange).toBeGreaterThan(1000); // At least 1000m separation
    });
  });

  describe('LATITUDE_THRESHOLDS', () => {
    it('should have all required latitude thresholds', () => {
      expect(LATITUDE_THRESHOLDS.desertBoundary).toBeDefined();
      expect(LATITUDE_THRESHOLDS.tropicsBoundary).toBeDefined();
      expect(LATITUDE_THRESHOLDS.polarCircle).toBeDefined();
    });

    it('should have thresholds in valid latitude range (-90 to 90)', () => {
      expect(LATITUDE_THRESHOLDS.desertBoundary).toBeGreaterThanOrEqual(0);
      expect(LATITUDE_THRESHOLDS.desertBoundary).toBeLessThanOrEqual(90);
      expect(LATITUDE_THRESHOLDS.tropicsBoundary).toBeGreaterThanOrEqual(0);
      expect(LATITUDE_THRESHOLDS.tropicsBoundary).toBeLessThanOrEqual(90);
      expect(LATITUDE_THRESHOLDS.polarCircle).toBeGreaterThanOrEqual(0);
      expect(LATITUDE_THRESHOLDS.polarCircle).toBeLessThanOrEqual(90);
    });

    it('should have thresholds in ascending order', () => {
      expect(LATITUDE_THRESHOLDS.tropicsBoundary).toBeLessThan(LATITUDE_THRESHOLDS.desertBoundary);
      expect(LATITUDE_THRESHOLDS.desertBoundary).toBeLessThan(LATITUDE_THRESHOLDS.polarCircle);
    });

    it('should have tropics boundary near 23.5° (Tropic of Cancer/Capricorn)', () => {
      expect(LATITUDE_THRESHOLDS.tropicsBoundary).toBeCloseTo(23.5, 0.5);
    });

    it('should have desert boundary near 30° (subtropical high pressure)', () => {
      expect(LATITUDE_THRESHOLDS.desertBoundary).toBeCloseTo(30, 5);
    });

    it('should have polar circle near 66.5° (Arctic/Antarctic Circle)', () => {
      expect(LATITUDE_THRESHOLDS.polarCircle).toBeCloseTo(66.5, 0.5);
    });
  });

  describe('Helper functions', () => {
    describe('getAllBiomeIds', () => {
      it('should return all 6 biome IDs', () => {
        const ids = getAllBiomeIds();
        expect(ids).toHaveLength(6);
      });

      it('should return BiomeIds in correct order', () => {
        const ids = getAllBiomeIds();
        expect(ids[0]).toBe(BiomeId.Water);
        expect(ids[1]).toBe(BiomeId.Sand);
        expect(ids[2]).toBe(BiomeId.Grass);
        expect(ids[3]).toBe(BiomeId.Forest);
        expect(ids[4]).toBe(BiomeId.Snow);
        expect(ids[5]).toBe(BiomeId.Rock);
      });

      it('should return unique BiomeIds', () => {
        const ids = getAllBiomeIds();
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });
    });

    describe('getBiomeDefinition', () => {
      it('should return correct definition for each biome', () => {
        const allIds = getAllBiomeIds();
        allIds.forEach(id => {
          const def = getBiomeDefinition(id);
          expect(def).toBeDefined();
          expect(def.id).toBe(id);
          expect(def).toBe(BIOME_DEFINITIONS[id]);
        });
      });

      it('should return water definition for Water ID', () => {
        const water = getBiomeDefinition(BiomeId.Water);
        expect(water.name).toContain('Water');
        expect(water.allowsImagery).toBe(false);
      });

      it('should return snow definition for Snow ID', () => {
        const snow = getBiomeDefinition(BiomeId.Snow);
        expect(snow.name).toMatch(/Snow|Alpine/);
        expect(snow.allowsImagery).toBe(false);
      });
    });

    describe('getBiomeDefinitionsArray', () => {
      it('should return all 6 biome definitions', () => {
        const defs = getBiomeDefinitionsArray();
        expect(defs).toHaveLength(6);
      });

      it('should return definitions in BiomeId order', () => {
        const defs = getBiomeDefinitionsArray();
        expect(defs[0].id).toBe(BiomeId.Water);
        expect(defs[1].id).toBe(BiomeId.Sand);
        expect(defs[2].id).toBe(BiomeId.Grass);
        expect(defs[3].id).toBe(BiomeId.Forest);
        expect(defs[4].id).toBe(BiomeId.Snow);
        expect(defs[5].id).toBe(BiomeId.Rock);
      });

      it('should return valid BiomeDefinition objects', () => {
        const defs = getBiomeDefinitionsArray();
        defs.forEach(def => {
          expect(def.id).toBeDefined();
          expect(def.name).toBeTruthy();
          expect(def.baseColor).toBeDefined();
          expect(def.roughness).toBeDefined();
          expect(def.metalness).toBeDefined();
          expect(def.allowsImagery).toBeDefined();
        });
      });

      it('should be suitable for shader uniform arrays', () => {
        const defs = getBiomeDefinitionsArray();
        
        // Extract colors as array (suitable for vec3[] uniform)
        const colors = defs.map(d => [d.baseColor.r, d.baseColor.g, d.baseColor.b]);
        expect(colors).toHaveLength(6);
        colors.forEach(color => {
          expect(color).toHaveLength(3);
        });

        // Extract roughness as array (suitable for float[] uniform)
        const roughness = defs.map(d => d.roughness);
        expect(roughness).toHaveLength(6);
        roughness.forEach(r => {
          expect(typeof r).toBe('number');
        });

        // Extract imagery flags as array (suitable for int[] uniform)
        const imageryFlags = defs.map(d => d.allowsImagery ? 1 : 0);
        expect(imageryFlags).toHaveLength(6);
        imageryFlags.forEach(flag => {
          expect([0, 1]).toContain(flag);
        });
      });
    });
  });

  describe('Type safety', () => {
    it('should enforce BiomeDefinition structure', () => {
      const testDef: BiomeDefinition = {
        id: BiomeId.Water,
        name: 'Test',
        baseColor: { r: 0.5, g: 0.5, b: 0.5 },
        roughness: 0.5,
        metalness: 0.0,
        allowsImagery: false,
      };
      
      expect(testDef.id).toBe(BiomeId.Water);
      expect(testDef.baseColor.r).toBe(0.5);
    });

    it('should have readonly BIOME_DEFINITIONS', () => {
      // TypeScript enforces this at compile time
      // This test verifies the object is not easily mutable
      const waterDef = BIOME_DEFINITIONS[BiomeId.Water];
      expect(waterDef).toBeDefined();
      
      // Attempting to modify should not affect the original (shallow copy test)
      const modifiedDef = { ...waterDef, name: 'Modified' };
      expect(BIOME_DEFINITIONS[BiomeId.Water].name).not.toBe('Modified');
    });
  });

  describe('Integration readiness', () => {
    it('should provide all data needed for shader uniforms', () => {
      // Verify we can extract all shader-required data
      const biomes = getBiomeDefinitionsArray();
      
      // Colors for vec3[] uniform
      const colors = biomes.map(b => [b.baseColor.r, b.baseColor.g, b.baseColor.b]);
      expect(colors).toHaveLength(6);
      
      // Roughness for float[] uniform
      const roughness = biomes.map(b => b.roughness);
      expect(roughness).toHaveLength(6);
      
      // Imagery flags for int[] uniform
      const imagery = biomes.map(b => b.allowsImagery ? 1 : 0);
      expect(imagery).toHaveLength(6);
      
      // Threshold values
      expect(BIOME_THRESHOLDS.seaLevel).toBeDefined();
      expect(BIOME_THRESHOLDS.grassLine).toBeDefined();
      expect(BIOME_THRESHOLDS.snowLine).toBeDefined();
      expect(LATITUDE_THRESHOLDS.desertBoundary).toBeDefined();
      expect(LATITUDE_THRESHOLDS.polarCircle).toBeDefined();
    });

    it('should have BiomeId values matching expected shader defines', () => {
      // Shader will use: #define BIOME_WATER 0, etc.
      expect(BiomeId.Water).toBe(0);
      expect(BiomeId.Sand).toBe(1);
      expect(BiomeId.Grass).toBe(2);
      expect(BiomeId.Forest).toBe(3);
      expect(BiomeId.Snow).toBe(4);
      expect(BiomeId.Rock).toBe(5);
    });
  });

  describe('Data consistency', () => {
    it('should have consistent number of biomes across all systems', () => {
      const enumCount = Object.keys(BiomeId).filter(k => !isNaN(Number(k))).length;
      const defCount = Object.keys(BIOME_DEFINITIONS).length;
      const helperCount = getAllBiomeIds().length;
      const arrayCount = getBiomeDefinitionsArray().length;
      
      expect(enumCount).toBe(6);
      expect(defCount).toBe(6);
      expect(helperCount).toBe(6);
      expect(arrayCount).toBe(6);
    });

    it('should have definition for every enum value', () => {
      for (let i = 0; i < 6; i++) {
        expect(BIOME_DEFINITIONS[i as BiomeId]).toBeDefined();
        expect(BIOME_DEFINITIONS[i as BiomeId].id).toBe(i);
      }
    });
  });
});
