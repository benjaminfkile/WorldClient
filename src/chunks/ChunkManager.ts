import * as THREE from "three";
import { TerrainChunkLoader } from "./TerrainChunkLoader";
import { TerrainMeshBuilder } from "./TerrainMeshBuilder";

const CHUNK_SIZE = 100;
const LOAD_RADIUS = 10; // Load chunks within this radius (in chunks)
const UNLOAD_RADIUS = 12; // Unload chunks outside this radius (prevents oscillation)
const MAX_CONCURRENT_LOADS = 20; // Never exceed this many simultaneous fetches
const RETRY_DELAY_MS = 750;
const FAILED_CHUNK_COOLDOWN_MS = 5000;

// Distance bands mapped to desired resolutions; tweak values to tune LOD behavior.
const LOD_LEVELS: Array<{ maxDistance: number; resolution: number }> = [
    { maxDistance: 120, resolution: 128 },
    { maxDistance: 200, resolution: 64 },
    { maxDistance: 600, resolution: 32 },
    { maxDistance: Infinity, resolution: 16 },
];

export class ChunkManager {
    private scene: THREE.Scene;
    private meshBuilder: TerrainMeshBuilder;
    
    // Track loaded chunks: key = "chunkX,chunkZ", value = THREE.Mesh
    private loadedChunks = new Map<string, THREE.Mesh>();
    
    // Track chunks currently being loaded to prevent duplicate requests
    private loadingChunks = new Set<string>();
    
    // Priority queue for pending chunk loads: { chunkX, chunkZ, distanceSquared, resolution }
    // Sorted by distance (closest first)
    private loadQueue: Array<{ chunkX: number; chunkZ: number; distanceSquared: number; resolution: number }> = [];
    
    // Track chunks pending retry (202 response): key = "chunkX,chunkZ", value = nextRetryTimeMs
    private pendingRetryChunks = new Map<string, number>();
    
    // Track chunks that failed to load: key = "chunkX,chunkZ", value = nextRetryTimeMs
    private failedChunks = new Map<string, number>();
    
    // Track chunks permanently blacklisted (decode/build errors): key = "chunkX,chunkZ"
    private blacklistedChunks = new Set<string>();
    
    // Track AbortControllers for in-flight requests
    private abortControllers = new Map<string, AbortController>();

    // Track the resolution currently being fetched per chunk key
    private loadingResolutions = new Map<string, number>();

    // World version for API calls
    private worldVersion: string;

    constructor(scene: THREE.Scene, debugVisuals: boolean, worldVersion: string) {
        this.scene = scene;
        this.meshBuilder = new TerrainMeshBuilder(debugVisuals);
        this.worldVersion = worldVersion;
    }

    public setDebugVisuals(enabled: boolean): void {
        this.meshBuilder.setDebugVisuals(enabled);
        
        // Rebuild all loaded chunks with correct materials
        const chunksToRebuild = Array.from(this.loadedChunks.entries());
        
        // Remove all chunks from scene and maps
        chunksToRebuild.forEach(([key, mesh]) => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((mat: THREE.Material) => mat.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        });
        this.loadedChunks.clear();
        
        // Re-add chunks with correct debug materials
        chunksToRebuild.forEach(([key, originalMesh]) => {
            const chunkX = originalMesh.userData.chunkX;
            const chunkZ = originalMesh.userData.chunkZ;
            
            // Get the original geometry
            const geometry = originalMesh.geometry.clone() as THREE.PlaneGeometry;
            
            // Recreate chunk data to rebuild mesh
            const resolution = geometry.parameters.widthSegments;
            const positions = geometry.attributes.position as THREE.BufferAttribute;
            const heights: number[] = [];
            
            for (let i = 0; i < positions.count; i++) {
                heights.push(positions.getY(i));
            }
            
            const chunkData = {
                chunkX,
                chunkZ,
                terrain: { resolution, heights },
                roads: [],
                rivers: []
            };
            
            const newMesh = this.meshBuilder.buildTerrainMesh(chunkData);
            this.loadedChunks.set(key, newMesh);
            this.scene.add(newMesh);
        });
    }

    private getChunkKey(chunkX: number, chunkZ: number): string {
        return `${chunkX},${chunkZ}`;
    }

    private getChunkCoords(worldX: number, worldZ: number): [number, number] {
        return [
            Math.floor(worldX / CHUNK_SIZE),
            Math.floor(worldZ / CHUNK_SIZE)
        ];
    }

    // Calculate squared distance from camera chunk to target chunk
    private calculateChunkDistance(
        cameraChunkX: number,
        cameraChunkZ: number,
        targetChunkX: number,
        targetChunkZ: number
    ): number {
        const dx = targetChunkX - cameraChunkX;
        const dz = targetChunkZ - cameraChunkZ;
        return dx * dx + dz * dz;
    }

    // Calculate true world-space distance from camera to chunk center (meters)
    private calculateChunkCenterDistance(
        cameraPosition: THREE.Vector3,
        chunkX: number,
        chunkZ: number
    ): number {
        const centerX = chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
        const centerZ = chunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
        const dx = centerX - cameraPosition.x;
        const dz = centerZ - cameraPosition.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    // Derive LOD purely from camera distance to keep deterministic, cache-friendly URLs
    private selectResolution(distanceMeters: number): number {
        for (const level of LOD_LEVELS) {
            if (distanceMeters <= level.maxDistance) {
                return level.resolution;
            }
        }
        return LOD_LEVELS[LOD_LEVELS.length - 1].resolution;
    }

    private getMeshResolution(mesh: THREE.Mesh): number | undefined {
        const geometry = mesh.geometry as THREE.PlaneGeometry | undefined;
        return geometry?.parameters.widthSegments;
    }

    // Enqueue a chunk for loading, maintaining distance-based priority
    private enqueueChunkLoad(
        chunkX: number,
        chunkZ: number,
        cameraChunkX: number,
        cameraChunkZ: number,
        resolution: number
    ): void {
        const distanceSquared = this.calculateChunkDistance(
            cameraChunkX,
            cameraChunkZ,
            chunkX,
            chunkZ
        );

        // Remove any existing entry so we can reinsert with updated resolution/distance
        const existingIndex = this.loadQueue.findIndex(
            item => item.chunkX === chunkX && item.chunkZ === chunkZ
        );
        if (existingIndex !== -1) {
            const existing = this.loadQueue[existingIndex];
            if (existing.resolution === resolution && existing.distanceSquared === distanceSquared) {
                return;
            }
            this.loadQueue.splice(existingIndex, 1);
        }
        
        // Insert in sorted order (closest first)
        const insertIdx = this.loadQueue.findIndex(
            item => distanceSquared < item.distanceSquared
        );
        
        if (insertIdx === -1) {
            this.loadQueue.push({ chunkX, chunkZ, distanceSquared, resolution });
        } else {
            this.loadQueue.splice(insertIdx, 0, { chunkX, chunkZ, distanceSquared, resolution });
        }
    }

    // Process the load queue, respecting MAX_CONCURRENT_LOADS limit
    private processLoadQueue(): void {
        // Start new loads only if we're below the concurrent limit
        while (this.loadingChunks.size < MAX_CONCURRENT_LOADS && this.loadQueue.length > 0) {
            const item = this.loadQueue.shift();
            if (!item) break;
            
            const key = this.getChunkKey(item.chunkX, item.chunkZ);
            const existingMesh = this.loadedChunks.get(key);
            const meshResolution = existingMesh ? this.getMeshResolution(existingMesh) : undefined;
            const loadingResolution = this.loadingResolutions.get(key);
            
            // Skip if already loaded, blacklisted, or currently loading
            if (
                this.blacklistedChunks.has(key) ||
                loadingResolution === item.resolution ||
                meshResolution === item.resolution
            ) {
                continue;
            }
            
            // Skip if failed with active cooldown
            const failTime = this.failedChunks.get(key);
            if (failTime !== undefined && Date.now() < failTime) {
                // Re-enqueue to try again later
                this.loadQueue.push(item);
                continue;
            }
            
            // Start the load
            this.loadChunk(item.chunkX, item.chunkZ, item.resolution);
        }
    }

    // Log chunk state transitions (dev only)
    private logStateTransition(key: string, oldState: string, newState: string): void {
        if (process.env.NODE_ENV === 'development') {
            console.log(`[Chunk] State: ${key} ${oldState} -> ${newState}`);
        }
    }

    private async loadChunk(chunkX: number, chunkZ: number, resolution: number): Promise<void> {
        const key = this.getChunkKey(chunkX, chunkZ);
        
        // Skip if permanently blacklisted (decode/build errors)
        if (this.blacklistedChunks.has(key)) return;

        const existingMesh = this.loadedChunks.get(key);
        const meshResolution = existingMesh ? this.getMeshResolution(existingMesh) : undefined;
        const loadingResolution = this.loadingResolutions.get(key);

        // Skip if already loaded at desired resolution
        if (meshResolution === resolution) return;

        // Skip if already loading desired resolution
        if (this.loadingChunks.has(key) && loadingResolution === resolution) return;

        // Skip if failed (network/fetch) and cooldown not expired
        const failTime = this.failedChunks.get(key);
        if (failTime !== undefined && Date.now() < failTime) return;

        this.loadingChunks.add(key);
        
        // Remove from failed chunks when retrying
        this.failedChunks.delete(key);
        
        // Remove from pending retry since we're attempting load now
        this.pendingRetryChunks.delete(key);
        
        // Create AbortController for this request
        const abortController = new AbortController();
        this.abortControllers.set(key, abortController);
        this.loadingResolutions.set(key, resolution);
        
        this.logStateTransition(key, 'idle', 'fetching');

        try {
            const data = await TerrainChunkLoader.fetchChunkOnce(
                chunkX,
                chunkZ,
                resolution,
                abortController.signal,
                this.worldVersion
            );
            
            // If null, chunk returned 202 and is scheduled for retry
            if (data === null) {
                this.logStateTransition(key, 'fetching', 'pending-retry');
                this.pendingRetryChunks.set(key, Date.now() + RETRY_DELAY_MS);
                this.loadingChunks.delete(key);
                this.abortControllers.delete(key);
                // Process queue after this load completes to start next one
                this.processLoadQueue();
                return;
            }
            
            // Double-check chunk wasn't unloaded while waiting
            if (!this.loadingChunks.has(key)) {
                this.loadingChunks.delete(key);
                this.abortControllers.delete(key);
                this.processLoadQueue();
                return;
            }
            
            try {
                const mesh = this.meshBuilder.buildTerrainMesh(data);
                this.logStateTransition(key, 'fetching', 'mesh-built');
                
                // Swap in the new mesh; keep the old one visible until replacement to avoid visible gaps
                const oldMesh = this.loadedChunks.get(key);
                if (oldMesh) {
                    this.scene.remove(oldMesh);
                    if (oldMesh.geometry) oldMesh.geometry.dispose();
                    if (oldMesh.material) {
                        if (Array.isArray(oldMesh.material)) {
                            oldMesh.material.forEach((mat: THREE.Material) => mat.dispose());
                        } else {
                            oldMesh.material.dispose();
                        }
                    }
                }

                this.loadedChunks.set(key, mesh);
                this.scene.add(mesh);
                this.logStateTransition(key, 'mesh-built', 'loaded');
            } catch (meshError) {
                // Mesh build failed - permanently blacklist this chunk
                console.error(`[Chunk] MESH BUILD FAILED for ${key}:`, meshError);
                this.blacklistedChunks.add(key);
                this.logStateTransition(key, 'fetching', 'blacklisted (mesh-build-error)');
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                // Silently ignore abort
                this.logStateTransition(key, 'fetching', 'aborted');
            } else if (error instanceof Error && error.message.includes('Buffer size mismatch')) {
                // Decode/validation error - permanently blacklist
                console.error(`[Chunk] DECODE FAILED for ${key}:`, error.message);
                this.blacklistedChunks.add(key);
                this.logStateTransition(key, 'fetching', 'blacklisted (decode-error)');
            } else {
                // Network/fetch error - set cooldown for retry
                console.error(`[Chunk] FETCH FAILED for ${key}:`, error);
                this.failedChunks.set(key, Date.now() + FAILED_CHUNK_COOLDOWN_MS);
                this.logStateTransition(key, 'fetching', 'failed (retry in 5s)');
            }
        } finally {
            this.loadingChunks.delete(key);
            this.loadingResolutions.delete(key);
            this.abortControllers.delete(key);
            // Process queue to start the next load
            this.processLoadQueue();
        }
    }

    private unloadChunk(chunkX: number, chunkZ: number): void {
        const key = this.getChunkKey(chunkX, chunkZ);
        
        // Cancel any in-flight request
        const abortController = this.abortControllers.get(key);
        if (abortController) {
            abortController.abort();
            this.abortControllers.delete(key);
        }
        
        // Remove from all tracking maps
        this.loadingChunks.delete(key);
        this.pendingRetryChunks.delete(key);
        this.failedChunks.delete(key);
        this.blacklistedChunks.delete(key);
        this.loadingResolutions.delete(key);
        
        // Get and remove mesh
        const mesh = this.loadedChunks.get(key);
        if (!mesh) return;

        // Remove from scene
        this.scene.remove(mesh);

        // Dispose geometry
        if (mesh.geometry) {
            mesh.geometry.dispose();
        }

        // Dispose material(s)
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach((mat: THREE.Material) => mat.dispose());
            } else {
                mesh.material.dispose();
            }
        }

        // Remove from map
        this.loadedChunks.delete(key);
    }

    public update(cameraPosition: THREE.Vector3): void {
        const now = Date.now();
        
        const [cameraChunkX, cameraChunkZ] = this.getChunkCoords(
            cameraPosition.x,
            cameraPosition.z
        );
        
        // Determine which chunks should be loaded within LOAD_RADIUS
        const enqueuedThisUpdate = new Set<string>();

        for (let x = cameraChunkX - LOAD_RADIUS; x <= cameraChunkX + LOAD_RADIUS; x++) {
            for (let z = cameraChunkZ - LOAD_RADIUS; z <= cameraChunkZ + LOAD_RADIUS; z++) {
                const key = this.getChunkKey(x, z);
                const distanceMeters = this.calculateChunkCenterDistance(cameraPosition, x, z);
                const desiredResolution = this.selectResolution(distanceMeters);
                
                // Skip if permanently blacklisted
                if (this.blacklistedChunks.has(key)) continue;
                
                // If an in-flight fetch targets a different resolution, abort and retry with the desired LOD
                const loadingResolution = this.loadingResolutions.get(key);
                if (loadingResolution !== undefined && loadingResolution !== desiredResolution) {
                    const abortController = this.abortControllers.get(key);
                    if (abortController) {
                        abortController.abort();
                    }
                    this.loadingChunks.delete(key);
                    this.loadingResolutions.delete(key);
                    this.abortControllers.delete(key);
                }

                // Skip if already processed this update
                if (enqueuedThisUpdate.has(key)) continue;
                
                // Skip if a fetch at the desired resolution is already in flight
                if (this.loadingChunks.has(key) && loadingResolution === desiredResolution) continue;

                // If already loaded at desired resolution, no action needed
                const existingMesh = this.loadedChunks.get(key);
                const meshResolution = existingMesh ? this.getMeshResolution(existingMesh) : undefined;
                if (meshResolution === desiredResolution) continue;
                
                // Skip if failed (network) and cooldown not expired
                const failTime = this.failedChunks.get(key);
                if (failTime !== undefined && now < failTime) continue;
                
                // Check if pending retry and not yet time to retry
                const nextRetryTime = this.pendingRetryChunks.get(key);
                if (nextRetryTime !== undefined && now < nextRetryTime) continue;
                
                enqueuedThisUpdate.add(key);
                this.enqueueChunkLoad(x, z, cameraChunkX, cameraChunkZ, desiredResolution);
            }
        }

        // Process pending retries that are now ready
        this.pendingRetryChunks.forEach((nextRetryTime, key) => {
            if (now >= nextRetryTime && !enqueuedThisUpdate.has(key)) {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                const distanceMeters = this.calculateChunkCenterDistance(cameraPosition, chunkX, chunkZ);
                const desiredResolution = this.selectResolution(distanceMeters);
                enqueuedThisUpdate.add(key);
                this.enqueueChunkLoad(chunkX, chunkZ, cameraChunkX, cameraChunkZ, desiredResolution);
                // Remove from pendingRetryChunks so it goes through normal loading flow
                this.pendingRetryChunks.delete(key);
            }
        });

        // Unload chunks outside UNLOAD_RADIUS (hysteresis prevents oscillation)
        const chunksToUnload: Array<[number, number]> = [];
        this.loadedChunks.forEach((mesh: THREE.Mesh, key: string) => {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            const dx = Math.abs(chunkX - cameraChunkX);
            const dz = Math.abs(chunkZ - cameraChunkZ);
            
            if (dx > UNLOAD_RADIUS || dz > UNLOAD_RADIUS) {
                chunksToUnload.push([chunkX, chunkZ]);
            }
        });

        chunksToUnload.forEach(([x, z]) => this.unloadChunk(x, z));

        // Start processing the load queue
        this.processLoadQueue();
    }

    public getLoadedChunk(chunkX: number, chunkZ: number): THREE.Mesh | undefined {
        const key = this.getChunkKey(chunkX, chunkZ);
        return this.loadedChunks.get(key);
    }

    public getLoadQueueSize(): number {
        return this.loadQueue.length;
    }

    public getLoadingCount(): number {
        return this.loadingChunks.size;
    }

    public destroy(): void {
        // Cancel all in-flight requests
        this.abortControllers.forEach(controller => controller.abort());
        this.abortControllers.clear();
        this.loadingResolutions.clear();
        
        // Clear load queue
        this.loadQueue.length = 0;
        
        // Cleanup: unload all chunks
        const allChunks = Array.from(this.loadedChunks.keys());
        allChunks.forEach((key: string) => {
            const [chunkX, chunkZ] = key.split(',').map(Number);
            this.unloadChunk(chunkX, chunkZ);
        });
    }
}
