# Low-Poly Accurate Earth Terrain Implementation Guide

## Overview

Implementing realistic, accurate Earth biomes in the low-poly 3D world. The approach is **shader-first, elevation-driven, and incremental**—each phase solves a specific problem and is debuggable before moving to the next.

**Architecture Principles:**
1. **Elevation + latitude** determine biome. This logic lives **in the fragment shader only**.
2. **TypeScript defines constants**—colors, thresholds, uniforms. No biome decisions in TypeScript.
3. **MapTiler imagery is optional**—it can tint biome colors, but never override them.
4. **Water is phased**—mask → shading → mesh → animation.

**Current State:**
- ✅ Terrain height data loading and mesh generation
- ✅ MapTiler custom map integration
- ✅ Web Mercator coordinate system + elevation geometry
- ✅ Material system (ready to extend)
- ❌ Biome selection logic (shader-based elevation rules)
- ❌ Water detection and shading
- ❌ Water separate mesh and animation (optional, advanced)
- ❌ Normal maps for detail (optional)

---

## Phase 1: Understand Current Architecture (Days 1-2)

### 1.1 Review the Terrain Pipeline

**Key Files:**
- [TerrainMeshBuilder.ts](src/chunks/TerrainMeshBuilder.ts) - Generates mesh geometry from heights
- [WorldBootstrapContext.tsx](src/WorldBootstrapContext.tsx) - World coordinate system
- [createRenderer.ts](src/engine/createRenderer.ts) - WebGL setup
- [lighting.ts](src/engine/lighting.ts) - Lighting setup

**Current Flow:**
```
API Height Data 
  → PlaneGeometry vertices
  → Apply heights to Y positions
  → Compute vertex normals
  → Apply MapTiler texture
  → Render with MeshStandardMaterial
```

### 1.2 Understanding Materials and Shaders in Three.js

**Key Concepts:**
- **Material** = Rendering instructions (color, roughness, textures, lighting)
- **Shader** = GPU code executed per-vertex and per-pixel (GLSL)
- **Uniform** = Global variable passed to shader (same for all pixels)
- **Varying** = Per-vertex data interpolated across pixels
- **Fragment Shader** = Code that decides pixel color (where biome logic goes)

**Existing Pattern:**
```typescript
material.onBeforeCompile = (shader) => {
  shader.uniforms = { ...shader.uniforms, ...customUniforms };
  shader.vertexShader = shader.vertexShader.replace(...);
  shader.fragmentShader = shader.fragmentShader.replace(...);
  material.needsUpdate = true;
}
```

Extend Three.js materials without rewriting from scratch.

### 1.3 Understanding World Space Coordinates

The system converts lat/lon to world coordinates:
- `vWorldPosition.x` = east-west (longitude)
- `vWorldPosition.y` = elevation (height above sea level)
- `vWorldPosition.z` = north-south (latitude)

**Key insight:** I can reconstruct latitude and elevation from `vWorldPosition` in the shader. I don't need to pass them separately.

---

## Phase 2: Create Biome Constants (Days 3-4)

### 2.1 Problem Statement

I need a single source of truth for biome definitions: what colors they use, how rough/shiny they are, and whether MapTiler imagery can override them.

### 2.2 Create `src/terrain/biomeConstants.ts`

This file defines biome metadata **only**. It does NOT make biome decisions.

```typescript
// src/terrain/biomeConstants.ts

export enum BiomeId {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Snow = 4,
  Rock = 5,
}

export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  baseColor: { r: number; g: number; b: number }; // 0-1 range
  roughness: number;
  metalness: number;
  allowsImagery: boolean; // Can MapTiler override this biome?
}

export const BIOME_DEFINITIONS: Record<BiomeId, BiomeDefinition> = {
  [BiomeId.Water]: {
    id: BiomeId.Water,
    name: 'Water',
    baseColor: { r: 0.1, g: 0.33, b: 0.56 },
    roughness: 0.2,
    metalness: 0.0,
    allowsImagery: false, // Water is water. Never override.
  },
  [BiomeId.Sand]: {
    id: BiomeId.Sand,
    name: 'Sand/Desert',
    baseColor: { r: 0.96, g: 0.64, b: 0.38 },
    roughness: 0.8,
    metalness: 0.0,
    allowsImagery: true, // Sand texture can vary
  },
  [BiomeId.Grass]: {
    id: BiomeId.Grass,
    name: 'Grassland',
    baseColor: { r: 0.18, g: 0.53, b: 0.35 },
    roughness: 0.7,
    metalness: 0.0,
    allowsImagery: true,
  },
  [BiomeId.Forest]: {
    id: BiomeId.Forest,
    name: 'Forest',
    baseColor: { r: 0.1, g: 0.35, b: 0.17 },
    roughness: 0.8,
    metalness: 0.0,
    allowsImagery: true,
  },
  [BiomeId.Snow]: {
    id: BiomeId.Snow,
    name: 'Snow/Alpine',
    baseColor: { r: 0.95, g: 0.95, b: 0.95 },
    roughness: 0.4,
    metalness: 0.0,
    allowsImagery: false, // Snow peaks are always white. No green.
  },
  [BiomeId.Rock]: {
    id: BiomeId.Rock,
    name: 'Rock/Mountain',
    baseColor: { r: 0.42, g: 0.42, b: 0.42 },
    roughness: 0.9,
    metalness: 0.0,
    allowsImagery: false, // Rock cliffs are always rock. No vegetation.
  },
};

// Thresholds for biome selection (in meters)
export const BIOME_THRESHOLDS = {
  seaLevel: 0,          // elevation < this = water
  grassLine: 500,       // elevation > this = grass/forest
  snowLine: 3000,       // elevation > this = snow
};

// Latitude thresholds (degrees, -90 to 90)
export const LATITUDE_THRESHOLDS = {
  desertBoundary: 30,       // Subtropical deserts near ±30°
  tropicsBoundary: 23.5,    // Tropic of Cancer/Capricorn
  polarCircle: 66.5,        // Arctic/Antarctic Circle
};
```

### 2.3 Why Biome Logic Lives Only in the Shader

**Per-pixel decisions must happen in the shader because:**
1. **Efficiency** - GPU processes millions of pixels simultaneously
2. **Correctness** - Every pixel needs its own biome decision
3. **Simplicity** - One function in one place (the shader)
4. **Debuggability** - Can see the exact logic

**TypeScript's role:**
- Define constants (colors, thresholds)
- Pass uniforms to the shader
- Toggle features on/off

The shader uses these uniforms to evaluate biome for each pixel.

---

## Phase 3: Implement Biome Selection in Shader (Days 5-7)

### 3.1 Problem Statement

Currently, color is determined purely by MapTiler. You need elevation + latitude to determine biome, with MapTiler as optional enhancement.

### 3.2 Extract Elevation and Latitude from vWorldPosition

I already have `vWorldPosition` in the fragment shader. This contains:
- `vWorldPosition.x` = east-west position
- `vWorldPosition.y` = **elevation** (source of truth)
- `vWorldPosition.z` = north-south position

**In the shader:**
```glsl
float elevation = vWorldPosition.y;

// Reconstruct latitude using world contract uniforms I already have
float latitude = uOriginLatLon.x + (vWorldPosition.z / uMetersPerDegreeLat);
```

That's it. No need to pass elevation separately.

### 3.3 Add Biome Selection to Fragment Shader

In [TerrainMeshBuilder.ts](src/chunks/TerrainMeshBuilder.ts), modify the `createImageryMaterial` method. Add this biome logic to the fragment shader:

```glsl
// Biome IDs (match biomeConstants.ts enum)
#define BIOME_WATER   0
#define BIOME_SAND    1
#define BIOME_GRASS   2
#define BIOME_FOREST  3
#define BIOME_SNOW    4
#define BIOME_ROCK    5

// Uniforms for biome definitions (passed from TypeScript)
uniform vec3 uBiomeColors[6];
uniform float uBiomeRoughness[6];
uniform int uBiomeAllowsImagery[6];

// Thresholds
uniform float uSeaLevel;
uniform float uGrassLine;
uniform float uSnowLine;
uniform float uPolarCircle;
uniform float uDesertBoundary;

/**
 * Determine which biome this pixel belongs to.
 * Rules: elevation > latitude > default
 */
int determineBiome(float elevation, float latitude) {
  // Water first
  if (elevation < uSeaLevel) {
    return BIOME_WATER;
  }
  
  // Polar regions are always snow
  if (abs(latitude) > uPolarCircle) {
    return BIOME_SNOW;
  }
  
  // High elevation is always snow
  if (elevation > uSnowLine) {
    return BIOME_SNOW;
  }
  
  // Deserts: warm, low elevation
  if (abs(latitude) < uDesertBoundary && elevation < uGrassLine) {
    return BIOME_SAND;
  }
  
  // Low elevation: grass
  if (elevation < uGrassLine) {
    return BIOME_GRASS;
  }
  
  // Mid elevation: forest
  if (elevation < (uSnowLine - 1000.0)) {
    return BIOME_FOREST;
  }
  
  // Default: rock (high, steep)
  return BIOME_ROCK;
}

/**
 * Get the final color for a biome.
 * If biome allows imagery (sand, grass, forest), blend with MapTiler.
 * Otherwise (water, snow, rock), use pure biome color.
 */
vec3 getBiomeColor(int biomeId, vec3 imageryColor) {
  vec3 biomeColor = uBiomeColors[biomeId];
  
  // Imagery allowed?
  if (uBiomeAllowsImagery[biomeId] == 1) {
    // Blend: biome color is primary, imagery adds detail
    return mix(biomeColor, imageryColor, 0.3);
  } else {
    // No imagery: pure biome color
    return biomeColor;
  }
}
```

### 3.4 Integrate Biome Selection Into Final Color

Find the part of the shader that currently applies color (usually `#include <map_fragment>`), and replace it with:

```glsl
// Extract position
float elevation = vWorldPosition.y;
float latitude = uOriginLatLon.x + (vWorldPosition.z / uMetersPerDegreeLat);

// Determine biome
int biomeId = determineBiome(elevation, latitude);

// Get MapTiler color
vec3 imageryColor = getImageryColor();

// Blend with biome
vec3 finalColor = getBiomeColor(biomeId, imageryColor);

diffuseColor = vec4(finalColor, diffuseColor.a);
```

### 3.5 Pass Biome Uniforms from TypeScript

In `createImageryMaterial`, add:

```typescript
import { BIOME_DEFINITIONS, BIOME_THRESHOLDS, LATITUDE_THRESHOLDS } from '../terrain/biomeConstants';

// ... existing code ...

const biomeUniforms = {
  uBiomeColors: {
    value: [
      new THREE.Vector3(0.1, 0.33, 0.56),   // WATER
      new THREE.Vector3(0.96, 0.64, 0.38),  // SAND
      new THREE.Vector3(0.18, 0.53, 0.35),  // GRASS
      new THREE.Vector3(0.1, 0.35, 0.17),   // FOREST
      new THREE.Vector3(0.95, 0.95, 0.95),  // SNOW
      new THREE.Vector3(0.42, 0.42, 0.42),  // ROCK
    ]
  },
  uBiomeRoughness: {
    value: [0.2, 0.8, 0.7, 0.8, 0.4, 0.9],
  },
  // allowsImagery: water, snow, rock = false (0); sand, grass, forest = true (1)
  uBiomeAllowsImagery: {
    value: [0, 1, 1, 1, 0, 0],
  },
  // Thresholds
  uSeaLevel: { value: BIOME_THRESHOLDS.seaLevel },
  uGrassLine: { value: BIOME_THRESHOLDS.grassLine },
  uSnowLine: { value: BIOME_THRESHOLDS.snowLine },
  uPolarCircle: { value: LATITUDE_THRESHOLDS.polarCircle },
  uDesertBoundary: { value: LATITUDE_THRESHOLDS.desertBoundary },
};

const uniforms = {
  ...existingUniforms,
  ...biomeUniforms,
};

material.onBeforeCompile = (shader) => {
  shader.uniforms = { ...shader.uniforms, ...uniforms };
  // ... rest of shader modifications
};
```

### 3.6 Testing Phase 3

**Checklist:**
- ✓ Biome colors appear based on elevation (not just MapTiler)
- ✓ Water is blue below sea level
- ✓ Snow is white above 3000m
- ✓ Grass is green below 500m in temperate zones
- ✓ Deserts appear near equator at low elevation
- ✓ Polar regions (above 66°N/S) are snow
- ✓ MapTiler detail shows through where allowed (grass, sand, forest)
- ✓ MapTiler is ignored where forbidden (snow, rock, water are pure colors)

**If biomes are wrong:** Adjust thresholds in `biomeConstants.ts`.

---

## Phase 4: Water Phase A — Shader Mask (Days 8-9)

### 4.1 Problem Statement

Water is now styled as a biome, but it's indistinguishable from terrain. We need to:
1. **Detect** water pixels (elevation < seaLevel)
2. **Mark** them for special treatment in later phases

### 4.2 Water is Already Detected (Phase 3)

The `determineBiome` function already returns `BIOME_WATER` for `elevation < uSeaLevel`. Water pixels are correctly identified.

### 4.3 Testing Phase 4A

**Checklist:**
- ✓ All pixels below sea level are blue
- ✓ All pixels above sea level are not blue (unless biome)
- ✓ Water appears in correct locations (oceans, major lakes)

**Verification:**
- Check the API: are elevation values correct?
- Compare to real map: Is water in the right places?

**Debug helper (temporary, in shader):**
```glsl
// Visualize only water to verify detection
if (biomeId != BIOME_WATER) discard;
```

**Why Phase 4A matters:** Water must be correctly detected before adding shading or animation. If elevation data is wrong, everything else is broken.

---

## Phase 5: Water Phase B — Shader Shading (Days 10-12)

### 5.1 Problem Statement

Water is blue, but flat and boring. Real water:
- Reflects sky (Fresnel effect)
- Changes color with depth
- Looks smooth/glossy

### 5.2 Add Water Shading to Shader

Add this function to the fragment shader:

```glsl
/**
 * Apply water-specific shading: fresnel reflection + depth color
 */
vec3 getWaterColor(vec3 baseWaterColor, vec3 viewDir, vec3 normal) {
  // Fresnel: look at water face-on = more color, look from the side = more reflection
  float fresnel = pow(1.0 - dot(viewDir, -normal), 3.0);
  
  // Shallow water: bright cyan. Deep water: dark blue.
  vec3 shallowWater = vec3(0.3, 0.8, 0.9);
  vec3 deepWater = baseWaterColor;
  
  // Simple depth: negative elevation = deeper underwater
  float depthFactor = clamp(-elevation / 100.0, 0.0, 1.0);
  vec3 depthColor = mix(shallowWater, deepWater, depthFactor);
  
  // Sky reflection (small amount at edges)
  vec3 skyColor = vec3(0.7, 0.85, 1.0);
  return mix(depthColor, skyColor, fresnel * 0.4);
}
```

### 5.3 Use Water Shading in Final Color

Replace the water color assignment:

```glsl
if (biomeId == BIOME_WATER) {
  vec3 waterColor = getWaterColor(
    uBiomeColors[BIOME_WATER],
    normalize(cameraPosition - vWorldPosition),
    normal
  );
  diffuseColor = vec4(waterColor, diffuseColor.a);
} else {
  // Standard biome path (from Phase 3)
  vec3 imageryColor = getImageryColor();
  vec3 finalColor = getBiomeColor(biomeId, imageryColor);
  diffuseColor = vec4(finalColor, diffuseColor.a);
}
```

### 5.4 Testing Phase 5B

**Checklist:**
- ✓ Water edges look slightly lighter (Fresnel visible)
- ✓ Deep water is darker than shallow
- ✓ Smooth color transitions (no banding)
- ✓ 60 FPS (no performance drop)

**Why Phase 5B matters:** Water shading adds depth and realism without any geometry changes. I can ship a beautiful ocean with just shader work.

---

## Phase 6: Water Phase C — Separate Water Mesh (Days 13-15)

### 6.1 Problem Statement

Shader water works, but has limitations:
- Can't support transparent/translucent water
- Can't do refraction (seeing terrain through water)
- Can't handle water above terrain (lakes in mountains)
- Animation requires terrain mesh deformation

**Phase C Solution:** Create a separate flat water mesh per chunk, rendered on top.

### 6.2 Create WaterMeshBuilder

Create [src/terrain/WaterMeshBuilder.ts](src/terrain/WaterMeshBuilder.ts):

```typescript
import * as THREE from 'three';
import { WorldChunk } from '../types';
import { WorldContract } from '../WorldBootstrapContext';

export class WaterMeshBuilder {
  private worldContract: WorldContract;

  constructor(worldContract: WorldContract) {
    this.worldContract = worldContract;
  }

  /**
   * Create a flat water surface plane for this chunk.
   * Water is at sea level (y=0) as a flat plane.
   * Returns null if chunk has no water.
   */
  public buildWaterMesh(chunk: WorldChunk): THREE.Mesh | null {
    const { heights } = chunk.terrain;
    
    // Does this chunk have water?
    const hasWater = heights.some(h => h < 0);
    if (!hasWater) return null;

    const chunkSizeMeters = this.worldContract.chunkSizeMeters;

    // Flat plane at sea level
    const geometry = new THREE.PlaneGeometry(
      chunkSizeMeters,
      chunkSizeMeters,
      1, // Low detail; water is flat
      1
    );
    geometry.rotateX(-Math.PI / 2);

    // Water material: blue, smooth, slightly reflective
    const material = new THREE.MeshStandardMaterial({
      color: 0x1a5490,
      emissive: 0x001a3d,
      emissiveIntensity: 0.05,
      metalness: 0.1,
      roughness: 0.2,
      side: THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      chunk.chunkX * chunkSizeMeters,
      0, // Sea level
      chunk.chunkZ * chunkSizeMeters
    );

    // Render order: water appears above terrain
    mesh.renderOrder = 1;

    return mesh;
  }
}
```

### 6.3 Integrate Into Chunk Rendering

Modify [TerrainMeshBuilder.ts](src/chunks/TerrainMeshBuilder.ts):

```typescript
import { WaterMeshBuilder } from '../terrain/WaterMeshBuilder';

export class TerrainMeshBuilder {
  private waterMeshBuilder: WaterMeshBuilder;

  constructor(...) {
    // ...
    this.waterMeshBuilder = new WaterMeshBuilder(worldContract);
  }

  public buildTerrainChunk(chunk: WorldChunk): THREE.Group {
    // Terrain
    const terrainMesh = this.buildTerrainMesh(chunk);
    
    // Water (optional)
    const waterMesh = this.waterMeshBuilder.buildWaterMesh(chunk);
    
    // Group
    const group = new THREE.Group();
    group.add(terrainMesh);
    if (waterMesh) {
      group.add(waterMesh);
    }
    
    return group;
  }
}
```

### 6.4 Optional: Discard Water Pixels in Terrain Shader

To prevent terrain showing through water, optionally add to terrain shader:

```glsl
// End of terrain fragment shader
if (biomeId == BIOME_WATER) {
  discard; // Don't render terrain where water is
}
```

### 6.5 Testing Phase 6C

**Checklist:**
- ✓ Water planes appear at sea level
- ✓ Water appears above terrain (render order correct)
- ✓ No z-fighting or flickering
- ✓ Chunk boundaries are clean (no gaps)

**Why Phase 6C matters:** Separates water from terrain. Enables transparency and animation in later phases.

---

## Phase 7: Water Phase D — Animation (Days 16-18)

### 7.1 Problem Statement

Static water is boring. Real water has waves and movement.

**Phase D Solution:** Add time-based animation via shader uniforms.

### 7.2 Add Wave Animation to Water Material

In `WaterMeshBuilder.ts`, modify the material:

```typescript
private buildWaterMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a5490,
    metalness: 0.1,
    roughness: 0.2,
  });

  material.onBeforeCompile = (shader) => {
    // Add time uniform
    shader.uniforms.uTime = { value: 0 };

    // Animate vertex height
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;`
    ).replace(
      '#include <project_vertex>',
      `vec3 pos = position;
       // Gentle waves
       pos.y += sin(pos.x * 0.03 + uTime * 0.5) * 0.2;
       pos.y += cos(pos.z * 0.03 + uTime * 0.5) * 0.2;
       #include <project_vertex>`
    );

    (material as any).userData.shader = shader;
  };

  material.needsUpdate = true;
  return material;
}
```

### 7.3 Update Time Uniform in Render Loop

In the render/animation loop:

```typescript
const startTime = Date.now();

function animate() {
  const elapsed = (Date.now() - startTime) / 1000; // seconds
  
  // Update all water materials
  scene.traverse((object) => {
    if (object.isMesh) {
      const shader = (object.material as any).userData?.shader;
      if (shader && shader.uniforms.uTime) {
        shader.uniforms.uTime.value = elapsed;
      }
    }
  });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
```

### 7.4 Testing Phase 7D

**Checklist:**
- ✓ Water surface gently undulates
- ✓ Waves loop smoothly
- ✓ 60 FPS maintained

**Why Phase 7D matters:** Animation makes the world feel alive. Optional but impactful.

---

## Phase 8: Normal Maps for Terrain (Days 19-21)

### 8.1 Problem Statement

Terrain looks flat despite height data. Real terrain has surface texture (bumpy grass, rough rock).

**Solution:** Add normal maps. They fake surface detail for lighting without extra geometry.

### 8.2 Create Basic Normal Map Generator

Create [src/terrain/normalMapGenerator.ts](src/terrain/normalMapGenerator.ts):

```typescript
import * as THREE from 'three';

export function createBasicNormalMap(width: number, height: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Neutral normal: (128, 128, 255) in RGB
  ctx.fillStyle = 'rgb(128, 128, 255)';
  ctx.fillRect(0, 0, width, height);

  // Add noise
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] += (Math.random() - 0.5) * 30;     // R
    data[i + 1] += (Math.random() - 0.5) * 30; // G
    data[i + 2] = 255;                         // B (always max)
    data[i + 3] = 255;                         // A (opaque)
  }

  ctx.putImageData(imageData, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
```

### 8.3 Apply Normal Map to Terrain

In `createImageryMaterial`:

```typescript
import { createBasicNormalMap } from '../terrain/normalMapGenerator';

private normalMap = createBasicNormalMap(512, 512);

private createImageryMaterial(chunk: WorldChunk): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    metalness: 0,
    roughness: 1,
    side: THREE.DoubleSide,
    normalMap: this.normalMap,           // NEW
    normalScale: new THREE.Vector2(0.3, 0.3), // Control strength
  });

  return material;
}
```

### 8.4 Testing Phase 8

**Checklist:**
- ✓ Terrain surface looks textured, not flat
- ✓ Lighting reacts to surface detail
- ✓ Normal intensity is subtle (adjust normalScale if too strong)
- ✓ No performance drop

**Why Phase 8 matters:** Normal maps add polish and realism with minimal cost.

---

## Phase 9: Performance and Polish (Days 22-24)

### 9.1 Shader Compilation Caching

Reduce stutters from repeated shader compilation:

```typescript
material.customProgramCacheKey = () => {
  return `terrain-biome-water-v1-${this.imageryZoom}`;
};
```

### 9.2 Mip-Mapping for Textures

Ensure textures filter correctly at distance:

```typescript
if (texture) {
  texture.minFilter = THREE.LinearMipMapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.maxAnisotropy;
}
```

### 9.3 Optional LOD (Level of Detail)

For distant terrain, simplify shading:

```typescript
const distanceFromCamera = camera.position.distanceTo(chunk.position);
const useBiomeShading = distanceFromCamera < 500;

const uniforms = {
  uUseBiomeShading: { value: useBiomeShading ? 1 : 0 },
};

// In shader:
if (uUseBiomeShading == 1) {
  // Full biome selection
} else {
  // Simplified: just MapTiler
}
```

---

## Phase 10: Testing, Debugging, and Iteration (Days 25+)

### 10.1 Create Debug Views

Add toggles to visualize what's happening:

```typescript
export const DEBUG_FLAGS = {
  showBiomeColorsOnly: false,      // Disable imagery
  showElevationHeatmap: false,      // Red = high, blue = low
  showLatitudeHeatmap: false,       // Red = equator, blue = poles
  showWaterMask: false,             // White = water
  wireframe: false,                 // See mesh density
};
```

Then in shader:
```glsl
#ifdef DEBUG_BIOME_ONLY
  diffuseColor = vec4(uBiomeColors[biomeId], 1.0);
#endif
```

### 10.2 Validation Checklist

**Biome Correctness:**
- ✓ Water appears below sea level
- ✓ Grass appears in temperate zones <500m
- ✓ Forest appears in tropical zones
- ✓ Snow appears above 3000m AND above 66.5° latitude
- ✓ Rock appears in steep areas
- ✓ Deserts appear in hot, dry zones

**Accuracy Against Real Earth:**
- ✓ Sahara (~22°N, <500m) = sand
- ✓ Amazon (~5°S, <500m) = forest
- ✓ Alps (~45°N, >2000m) = rock/snow
- ✓ Greenland (~70°N, sea level) = snow (latitude wins)
- ✓ Poles (>66.5°) = snow

**Water Correctness:**
- ✓ Water is always blue
- ✓ Water appears below terrain
- ✓ Water is flat
- ✓ No texture bleeding

**Performance:**
- ✓ 60 FPS on target hardware
- ✓ No shader compilation stutters
- ✓ Imagery loads smoothly

### 10.3 Fine-Tune Thresholds

Adjust these in `biomeConstants.ts`:

```typescript
BIOME_THRESHOLDS = {
  seaLevel: 0,      // Can adjust if data offset
  grassLine: 500,   // Try 400-600
  snowLine: 3000,   // Try 2500-3500
};

LATITUDE_THRESHOLDS = {
  desertBoundary: 30,    // ±30° has deserts
  polarCircle: 66.5,     // ±66.5° is always cold
};
```

### 10.4 Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| All one color | Biome function not in shader | Check `onBeforeCompile` |
| Water green | Imagery overriding water | Set `allowsImagery[WATER] = false` |
| Snow in wrong places | Bad thresholds | Adjust `snowLine`, `polarCircle` |
| Shader flicker | Recompilation | Add `customProgramCacheKey` |
| Normal maps invisible | No lighting | Check `lighting.ts` has DirectionalLight |
| Water doesn't animate | Time uniform not updating | Verify render loop updates `uTime` |

---

## Implementation Roadmap

```
Week 1:
  Day 1-2:   Phase 1 — Understand architecture
  Day 3-4:   Phase 2 — Biome constants
  Day 5-7:   Phase 3 — Shader biome selection
  Day 8-9:   Phase 4 — Water shader mask
  
Week 2:
  Day 10-12: Phase 5 — Water shader shading
  Day 13-15: Phase 6 — Water separate mesh
  Day 16-18: Phase 7 — Water animation
  
Week 3:
  Day 19-21: Phase 8 — Normal maps
  Day 22-24: Phase 9 — Performance
  Day 25+:   Phase 10 — Testing & iteration
```

---

## Final Code Structure

```
src/
  terrain/
    biomeConstants.ts      ← Biome colors, thresholds, definitions (no logic)
    normalMapGenerator.ts  ← Procedural normal map generation
    WaterMeshBuilder.ts    ← Creates flat water plane per chunk
  chunks/
    TerrainMeshBuilder.ts  ← Modified: biome shader + water mesh integration
  debug/
    DebugHUD.ts            ← Optional: debug toggles and visualization
  (other files unchanged)
```

---

## Key Principles

1. **Biome logic lives in fragment shader.** TypeScript defines constants only.
2. **Elevation is the source of truth.** Derived from `vWorldPosition.y`.
3. **MapTiler is optional.** It tints biomes, never overrides them.
4. **Water is phased.** Start with shader mask, add features incrementally.
5. **Debug early.** Use visualization flags at each step.
6. **Compare to reality.** Validate against real Earth.

---

## Resources

**Three.js & Shaders:**
- [Three.js Shader Injection](https://threejs.org/docs/#api/en/materials/ShaderMaterial)
- [The Book of Shaders](https://thebookofshaders.com/)
- [GLSL Reference](https://www.khronos.org/opengl/wiki/OpenGL_Shading_Language)

**Biomes & Terrain:**
- [Earth Biomes](https://en.wikipedia.org/wiki/Biome)
- [Köppen Climate Classification](https://en.wikipedia.org/wiki/K%C3%B6ppen_climate_classification)

**Textures:**
- [Poly Haven](https://polyhaven.com/)

---

## Success Criteria

- ✅ Fly over Earth and see accurate biomes
- ✅ Verify biomes match real locations
- ✅ See smooth color transitions
- ✅ Observe water physics (fresnel, depth, waves)
- ✅ Maintain 60 FPS
- ✅ Toggle thresholds and see results
- ✅ Extend water animation later

