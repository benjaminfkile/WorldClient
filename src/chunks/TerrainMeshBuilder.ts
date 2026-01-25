import * as THREE from "three";
import { ImageryTileCache } from "../imagery/ImageryTileCache";
import { getChunkTileCoverage, TileCoordinate } from "../imagery/tileMath";
import { WorldChunk } from "../types";
import type { WorldContract } from "../WorldBootstrapContext";

const IMAGERY_MAX_TILES = 6;
const DEFAULT_IMAGERY_ZOOM = parseInt(process.env.REACT_APP_IMAGERY_ZOOM ?? "11", 10);
const MAPTILER_MAP_ID = process.env.REACT_APP_MAPTILER_MAP_ID;
const sharedImageryCache = new ImageryTileCache(process.env.REACT_APP_API_URL ?? "", MAPTILER_MAP_ID);
const TEXTURE_UNIFORM_NAMES = Array.from({ length: IMAGERY_MAX_TILES }, (_, i) => `uImageryTexture${i}`);

export class TerrainMeshBuilder {
    private debugVisuals: boolean;
    private worldContract: WorldContract;
    private imageryTileCache: ImageryTileCache;
    private imageryZoom: number;
    private placeholderTexture: THREE.DataTexture;
    private fallbackColor: THREE.Color;

    constructor(debugVisuals: boolean, worldContract: WorldContract) {
        this.debugVisuals = debugVisuals;
        this.worldContract = worldContract;
        this.imageryTileCache = sharedImageryCache;
        this.imageryZoom = DEFAULT_IMAGERY_ZOOM;
        this.placeholderTexture = this.imageryTileCache.getPlaceholder();
        this.fallbackColor = new THREE.Color(0x6b6b6b);
    }

    public setDebugVisuals(enabled: boolean): void {
        this.debugVisuals = enabled;
    }

    public buildTerrainMesh(chunk: WorldChunk): THREE.Mesh {
        const { resolution, heights } = chunk.terrain;
        const chunkSizeMeters = this.worldContract.chunkSizeMeters;
        
        // Resolution is segments per side; vertex grid is (resolution + 1) x (resolution + 1)
        const geometry = new THREE.PlaneGeometry(
            chunkSizeMeters,
            chunkSizeMeters,
            resolution,  // widthSegments
            resolution   // heightSegments
        );

        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position as THREE.BufferAttribute;
        const gridSize = resolution + 1;
        const expectedCount = gridSize * gridSize;

        // Dev assertion: verify vertex count matches height count
        if (positions.count !== heights.length) {
            console.error(
                `Vertex count mismatch! positions.count=${positions.count}, heights.length=${heights.length}, ` +
                `expected=${expectedCount} (resolution=${resolution}, gridSize=${gridSize})`
            );
        }
        
        // Dev assertion: verify gridSize calculation
        if (expectedCount !== heights.length) {
            console.error(
                `Grid size mismatch! expectedCount=${expectedCount}, heights.length=${heights.length}, ` +
                `gridSize=${gridSize}, resolution=${resolution}`
            );
        }

        // Apply heights in row-major order: index = z * gridSize + x
        // PlaneGeometry vertices are laid out in the same row-major order after rotation
        // No flip needed - direct 1:1 mapping
        for (let z = 0; z < gridSize; z++) {
            for (let x = 0; x < gridSize; x++) {
                const index = z * gridSize + x;
                positions.setY(index, heights[index]);
            }
        }

        geometry.computeVertexNormals();
        geometry.computeBoundingBox();

        // Debug-friendly material to ensure visibility regardless of lighting/culling
        const material = this.debugVisuals
            ? new THREE.MeshBasicMaterial({
                color:
                    (chunk.chunkX + chunk.chunkZ) % 2 === 0
                        ? 0x55aa55
                        : 0x448844,
                wireframe: true,
                side: THREE.DoubleSide,
            })
            : this.createImageryMaterial(chunk);

        const mesh = new THREE.Mesh(geometry, material);
        if (this.debugVisuals) {
            // Avoid frustum culling while debugging chunk visibility
            mesh.frustumCulled = false;
        }

        mesh.position.set(
            chunk.chunkX * chunkSizeMeters,
            0,
            chunk.chunkZ * chunkSizeMeters
        );

        // Store chunk coordinates in userData for debug material switching
        mesh.userData.chunkX = chunk.chunkX;
        mesh.userData.chunkZ = chunk.chunkZ;
        if (!this.debugVisuals) {
            mesh.userData.tileSubscriptions = (material as any).userData?.tileSubscriptions ?? [];
        }

        return mesh;
    }

    private createImageryMaterial(chunk: WorldChunk): THREE.MeshStandardMaterial {
        const tiles = getChunkTileCoverage(
            chunk.chunkX,
            chunk.chunkZ,
            this.worldContract,
            this.imageryZoom
        ).slice(0, IMAGERY_MAX_TILES);

        const tileTextures: THREE.Texture[] = Array.from({ length: IMAGERY_MAX_TILES }, () => this.placeholderTexture);
        const tileCoords: THREE.Vector2[] = Array.from({ length: IMAGERY_MAX_TILES }, () => new THREE.Vector2(-1, -1));
        const cleanupSubscriptions: Array<() => void> = [];
        const pendingTextureUpdates: Record<number, THREE.Texture> = {};

        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            flatShading: true,
            metalness: 0,
            roughness: 1,
            side: THREE.DoubleSide,
        });

        const tileCount = Math.min(tiles.length, IMAGERY_MAX_TILES);
        for (let i = 0; i < tileCount; i++) {
            const tile = tiles[i];
            const fetchCoord = this.imageryTileCache.mapToFetchCoord(tile);
            tileCoords[i] = new THREE.Vector2(fetchCoord.x, fetchCoord.y);
            const handle = this.imageryTileCache.getTile(tile);

            if (handle.texture) {
                tileTextures[i] = handle.texture;
            }

            const uniformName = TEXTURE_UNIFORM_NAMES[i];
            const unsubscribe = handle.subscribe((texture) => {
                tileTextures[i] = texture;
                const shader = (material as any).userData?.shader as any;
                if (shader && shader.uniforms[uniformName]) {
                    shader.uniforms[uniformName].value = texture;
                    (shader as any).uniformsNeedUpdate = true;
                }
                if (!shader) {
                    pendingTextureUpdates[i] = texture;
                }
                material.needsUpdate = true;
            });
            cleanupSubscriptions.push(unsubscribe);
        }

        const textureUniforms: Record<string, { value: THREE.Texture }> = {};
        TEXTURE_UNIFORM_NAMES.forEach((name, idx) => {
            textureUniforms[name] = { value: tileTextures[idx] };
        });

        const uniforms = {
            uImageryZoomLevel: { value: this.imageryZoom },
            uImageryTileCount: { value: tileCount },
            uImageryTileCoords: { value: tileCoords },
            uImageryFallback: { value: this.fallbackColor },
            uOriginLatLon: { value: new THREE.Vector2(this.worldContract.origin.latitude, this.worldContract.origin.longitude) },
            uMetersPerDegreeLat: { value: this.worldContract.metersPerDegreeLatitude },
            uUseTms: { value: this.imageryTileCache.isTms() ? 1 : 0 },
            ...textureUniforms,
        };

        if (process.env.NODE_ENV === 'development') {
            const chunkWorldX = chunk.chunkX * this.worldContract.chunkSizeMeters;
            const chunkWorldZ = chunk.chunkZ * this.worldContract.chunkSizeMeters;
            const { latitude, longitude } = require('../world/worldMath').worldMetersToLatLon(
                chunkWorldX,
                chunkWorldZ,
                this.worldContract
            );
            console.log(`[TerrainMesh] Chunk ${chunk.chunkX},${chunk.chunkZ} tiles:`, tiles.map(t => `${t.z}/${t.x}/${t.y}`));
            console.log(`[TerrainMesh] Chunk SW corner: world(${chunkWorldX}, ${chunkWorldZ}) → lat/lon(${latitude.toFixed(6)}, ${longitude.toFixed(6)})`);
            console.log(`[TerrainMesh] Origin: ${this.worldContract.origin.latitude}, ${this.worldContract.origin.longitude}`);
            console.log(`[TerrainMesh] Zoom: ${this.imageryZoom}, MetersPerDegreeLat: ${this.worldContract.metersPerDegreeLatitude}`);
        }

        material.defines = {
            ...(material.defines ?? {}),
            IMAGERY_MAX_TILES,
        } as Record<string, unknown>;

        material.onBeforeCompile = (shader) => {
            shader.uniforms = {
                ...shader.uniforms,
                ...uniforms,
            };

            (material as any).userData.shader = shader;

            // Apply any textures that finished loading before compilation
            Object.entries(pendingTextureUpdates).forEach(([idxStr, tex]) => {
                const idx = Number(idxStr);
                const uniformName = TEXTURE_UNIFORM_NAMES[idx];
                if (shader.uniforms[uniformName]) {
                    shader.uniforms[uniformName].value = tex;
                }
            });
            if (Object.keys(pendingTextureUpdates).length > 0) {
                (shader as any).uniformsNeedUpdate = true;
            }

            shader.vertexShader = shader.vertexShader
                .replace(
                    "#include <common>",
                    `#include <common>\n            varying vec3 vWorldPosition;`
                )
                .replace(
                    "#include <project_vertex>",
                    `#include <project_vertex>\n            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`
                );

            const imageryChunk = `
            const float WEB_MERCATOR_MAX_LAT = 85.0511287798066;

            vec3 toLinear(vec3 srgb) {
                return pow(srgb, vec3(2.2));
            }

            bool tileMatches(vec2 tileIndex, vec2 target) {
                vec2 diff = abs(tileIndex - target);
                return all(lessThan(diff, vec2(0.01)));
            }

            vec3 sampleImagery(vec2 tileIndex, vec2 tileUv) {
                vec3 color = uImageryFallback;

                vec2 fetchTileIndex = tileIndex;
                if (uUseTms == 1) {
                    float maxIndex = exp2(float(uImageryZoomLevel)) - 1.0;
                    fetchTileIndex.y = maxIndex - tileIndex.y;
                }

                if (uImageryTileCount > 0 && tileMatches(fetchTileIndex, uImageryTileCoords[0])) {
                    color = toLinear(texture2D(uImageryTexture0, tileUv).rgb);
                }
                if (uImageryTileCount > 1 && tileMatches(fetchTileIndex, uImageryTileCoords[1])) {
                    color = toLinear(texture2D(uImageryTexture1, tileUv).rgb);
                }
                if (uImageryTileCount > 2 && tileMatches(fetchTileIndex, uImageryTileCoords[2])) {
                    color = toLinear(texture2D(uImageryTexture2, tileUv).rgb);
                }
                if (uImageryTileCount > 3 && tileMatches(fetchTileIndex, uImageryTileCoords[3])) {
                    color = toLinear(texture2D(uImageryTexture3, tileUv).rgb);
                }
                if (uImageryTileCount > 4 && tileMatches(fetchTileIndex, uImageryTileCoords[4])) {
                    color = toLinear(texture2D(uImageryTexture4, tileUv).rgb);
                }
                if (uImageryTileCount > 5 && tileMatches(fetchTileIndex, uImageryTileCoords[5])) {
                    color = toLinear(texture2D(uImageryTexture5, tileUv).rgb);
                }
                return color;
            }

            vec3 getImageryColor() {
                // Match worldMetersToLatLon exactly: uses ORIGIN latitude for longitude conversion
                float lat = uOriginLatLon.x + (vWorldPosition.z / uMetersPerDegreeLat);
                
                // Compute meters per degree longitude at ORIGIN latitude (flat-earth approximation)
                float originLatRad = radians(uOriginLatLon.x);
                float metersPerDegreeLon = uMetersPerDegreeLat * cos(originLatRad);
                float lon = uOriginLatLon.y + (vWorldPosition.x / metersPerDegreeLon);
                
                // Clamp latitude for Web Mercator
                lat = clamp(lat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT);
                
                // Compute Web Mercator tile coordinates
                float latRad = radians(lat);
                float n = exp2(float(uImageryZoomLevel));
                float tileX = ((lon + 180.0) / 360.0) * n;
                float tileY = (1.0 - log(tan(latRad) + 1.0 / cos(latRad)) / PI) / 2.0 * n;
                
                vec2 tileIndex = floor(vec2(tileX, tileY));
                vec2 tileUv = fract(vec2(tileX, tileY));
                tileUv.y = 1.0 - tileUv.y; // Tiles are top-left origin, UVs are bottom-left
                return sampleImagery(tileIndex, tileUv);
            }
            `;

            shader.fragmentShader = shader.fragmentShader
                .replace(
                    "#include <common>",
                    `#include <common>\n            varying vec3 vWorldPosition;\n            uniform vec2 uOriginLatLon;\n            uniform float uMetersPerDegreeLat;\n            uniform float uImageryZoomLevel;\n            uniform int uUseTms;\n            uniform int uImageryTileCount;\n            uniform vec2 uImageryTileCoords[IMAGERY_MAX_TILES];\n            uniform sampler2D uImageryTexture0;\n            uniform sampler2D uImageryTexture1;\n            uniform sampler2D uImageryTexture2;\n            uniform sampler2D uImageryTexture3;\n            uniform sampler2D uImageryTexture4;\n            uniform sampler2D uImageryTexture5;\n            uniform vec3 uImageryFallback;\n            ${imageryChunk}`
                )
                .replace(
                    "#include <map_fragment>",
                    `vec3 imageryColor = getImageryColor();\n            diffuseColor = vec4(imageryColor, diffuseColor.a);`
                );
        };

        material.customProgramCacheKey = () => `terrain-imagery-${IMAGERY_MAX_TILES}`;
        material.needsUpdate = true;
        (material as any).userData.tileSubscriptions = cleanupSubscriptions;

        return material;
    }
}
