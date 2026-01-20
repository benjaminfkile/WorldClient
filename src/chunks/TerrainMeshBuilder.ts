import * as THREE from "three";
import { WorldChunk } from "../types";

const CHUNK_SIZE = 100;

export class TerrainMeshBuilder {
    private debugVisuals: boolean;

    constructor(debugVisuals: boolean) {
        this.debugVisuals = debugVisuals;
    }

    public setDebugVisuals(enabled: boolean): void {
        this.debugVisuals = enabled;
    }

    public buildTerrainMesh(chunk: WorldChunk): THREE.Mesh {
        const { resolution, heights } = chunk.terrain;
        
        // Log height statistics
        const minHeight = Math.min(...heights);
        const maxHeight = Math.max(...heights);
        const heightRange = maxHeight - minHeight;
        if (process.env.NODE_ENV === 'development') {
            console.log(
                `[Chunk] Heights for ${chunk.chunkX},${chunk.chunkZ}: min=${minHeight}, max=${maxHeight}, range=${heightRange}`
            );
        }

        // Resolution is segments per side; vertex grid is (resolution + 1) x (resolution + 1)
        const geometry = new THREE.PlaneGeometry(
            CHUNK_SIZE,
            CHUNK_SIZE,
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
            : new THREE.MeshStandardMaterial({
                color:
                    (chunk.chunkX + chunk.chunkZ) % 2 === 0
                        ? 0x55aa55
                        : 0x448844,
                flatShading: true,
                side: THREE.DoubleSide,
            });

        const mesh = new THREE.Mesh(geometry, material);
        if (this.debugVisuals) {
            // Avoid frustum culling while debugging chunk visibility
            mesh.frustumCulled = false;
        }

        mesh.position.set(
            chunk.chunkX * CHUNK_SIZE,
            0,
            chunk.chunkZ * CHUNK_SIZE
        );

        // Store chunk coordinates in userData for debug material switching
        mesh.userData.chunkX = chunk.chunkX;
        mesh.userData.chunkZ = chunk.chunkZ;

        return mesh;
    }
}
