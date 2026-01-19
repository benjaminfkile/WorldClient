import * as THREE from "three";
import { JSX, useEffect, useRef } from "react";
import { WorldChunk } from "./types";

const CHUNK_SIZE = 100;
const LOAD_RADIUS = 10; // Load chunks within this radius (in chunks)
const UNLOAD_RADIUS = 12; // Unload chunks outside this radius (prevents oscillation)
let DEBUG_VISUALS = false; // Toggle temporary debug helpers/materials (press 'D' to toggle)
const UPDATE_CHUNKS_INTERVAL_MS = 250; // Update chunk visibility every ~250ms (4 times/sec)
const MAX_CONCURRENT_LOADS = 20; // Never exceed this many simultaneous fetches

// Geo-coordinate system for developer readout
const ORIGIN_LATITUDE = 46.8721;
const ORIGIN_LONGITUDE = -113.994;
const METERS_PER_DEGREE_LATITUDE = 111320;
// World X increases east (longitude), World Z increases north (latitude)
// One world unit equals one meter

export default function WorldScene(): JSX.Element {
    const mountRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87ceeb);

        const camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            100000  // Extended far plane for distant terrain
        );

        camera.position.set(0, 50, 100);
        // Ensure we're looking toward the origin initially so ground is in view
        camera.lookAt(new THREE.Vector3(0, 0, 0));

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        mount.appendChild(renderer.domElement);

        // Create developer HUD overlay (top-left corner)
        const hudOverlay = document.createElement('div');
        hudOverlay.style.position = 'fixed';
        hudOverlay.style.top = '10px';
        hudOverlay.style.left = '10px';
        hudOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        hudOverlay.style.color = '#00ff00';
        hudOverlay.style.fontFamily = 'monospace';
        hudOverlay.style.fontSize = '12px';
        hudOverlay.style.padding = '8px';
        hudOverlay.style.borderRadius = '4px';
        hudOverlay.style.zIndex = '1000';
        hudOverlay.style.pointerEvents = 'none';
        hudOverlay.style.whiteSpace = 'pre-wrap';
        hudOverlay.style.lineHeight = '1.4';
        document.body.appendChild(hudOverlay);

        // Track debug meshes for toggling (declared early so it's available for debug helpers)
        const debugMeshes: THREE.Object3D[] = [];

        // Debug helpers to visualize world orientation and origin
        if (DEBUG_VISUALS) {
            const gridSize = CHUNK_SIZE * LOAD_RADIUS * 3;
            const gridDivisions = LOAD_RADIUS * 6;
            const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x888888);
            // Drop the grid slightly below y=0 to avoid z-fighting with terrain
            gridHelper.position.y = -0.1;
            gridHelper.renderOrder = -1;
            scene.add(gridHelper);
            debugMeshes.push(gridHelper);

            const axesHelper = new THREE.AxesHelper(100);
            scene.add(axesHelper);
            debugMeshes.push(axesHelper);

            const testCube = new THREE.Mesh(
                new THREE.BoxGeometry(10, 10, 10),
                new THREE.MeshBasicMaterial({ color: 0xff0000 })
            );
            testCube.position.set(0, 5, 0);
            scene.add(testCube);
            debugMeshes.push(testCube);
        }

        // Camera rotation state
        let yaw = 0; // Horizontal rotation
        let pitch = 0; // Vertical rotation
        const maxPitch = Math.PI / 2 - 0.1; // Prevent camera flip

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(100, 200, 100);
        scene.add(light);

        // Track loaded chunks: key = "chunkX,chunkZ", value = THREE.Mesh
        const loadedChunks = new Map<string, THREE.Mesh>();

        // Track chunks currently being loaded to prevent duplicate requests
        const loadingChunks = new Set<string>();
        
        // Priority queue for pending chunk loads: { chunkX, chunkZ, distanceSquared }
        // Sorted by distance (closest first)
        const loadQueue: Array<{ chunkX: number; chunkZ: number; distanceSquared: number }> = [];
        
        // Track chunks pending retry (202 response): key = "chunkX,chunkZ", value = nextRetryTimeMs
        const pendingRetryChunks = new Map<string, number>();
        
        // Track chunks that failed to load: key = "chunkX,chunkZ", value = nextRetryTimeMs
        const failedChunks = new Map<string, number>();
        
        // Track chunks permanently blacklisted (decode/build errors): key = "chunkX,chunkZ"
        const blacklistedChunks = new Set<string>();
        
        // Track AbortControllers for in-flight requests
        const abortControllers = new Map<string, AbortController>();
        
        const RETRY_DELAY_MS = 750;
        const FAILED_CHUNK_COOLDOWN_MS = 5000;
        
        // Interval for processing chunk updates
        let updateChunksIntervalId: NodeJS.Timeout | null = null;

        // Update debug visuals (toggle meshes on/off and update materials)
        const updateDebugVisuals = () => {
            // Toggle initial debug meshes visibility
            debugMeshes.forEach(mesh => {
                mesh.visible = DEBUG_VISUALS;
            });
            
            // Remove old box helpers
            const oldHelpers = scene.children.filter(obj => obj instanceof THREE.Box3Helper);
            oldHelpers.forEach(helper => scene.remove(helper));
            
            // Rebuild all loaded chunks with correct materials
            const chunksToRebuild = Array.from(loadedChunks.entries());
            
            // Remove all chunks from scene and maps
            chunksToRebuild.forEach(([key, mesh]) => {
                scene.remove(mesh);
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach((mat: THREE.Material) => mat.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            });
            loadedChunks.clear();
            
            // Re-add chunks with correct debug materials
            chunksToRebuild.forEach(([key, originalMesh]) => {
                const chunkX = originalMesh.userData.chunkX;
                const chunkZ = originalMesh.userData.chunkZ;
                
                // Get the original geometry
                const geometry = originalMesh.geometry.clone() as THREE.PlaneGeometry;
                
                // Create new material based on current DEBUG_VISUALS setting
                const color = (chunkX + chunkZ) % 2 === 0 ? 0x55aa55 : 0x448844;
                const material = DEBUG_VISUALS
                    ? new THREE.MeshBasicMaterial({
                        color,
                        wireframe: true,
                        side: THREE.DoubleSide,
                    })
                    : new THREE.MeshStandardMaterial({
                        color,
                        flatShading: true,
                        side: THREE.DoubleSide,
                    });
                
                const newMesh = new THREE.Mesh(geometry, material);
                newMesh.userData.chunkX = chunkX;
                newMesh.userData.chunkZ = chunkZ;
                newMesh.frustumCulled = DEBUG_VISUALS ? false : true;
                newMesh.position.copy(originalMesh.position);
                
                loadedChunks.set(key, newMesh);
                scene.add(newMesh);
                
                // Add box helper if in debug mode
                if (DEBUG_VISUALS && geometry.boundingBox) {
                    const worldBox = new THREE.Box3().setFromObject(newMesh);
                    const boxHelper = new THREE.Box3Helper(worldBox, 0xffff00);
                    boxHelper.frustumCulled = false;
                    scene.add(boxHelper);
                }
            });
        };

        // Log chunk state transitions (dev only)
        const logStateTransition = (key: string, oldState: string, newState: string) => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`[Chunk] State: ${key} ${oldState} -> ${newState}`);
            }
        };

        const getChunkKey = (chunkX: number, chunkZ: number): string => {
            return `${chunkX},${chunkZ}`;
        };

        const getChunkCoords = (worldX: number, worldZ: number): [number, number] => {
            return [
                Math.floor(worldX / CHUNK_SIZE),
                Math.floor(worldZ / CHUNK_SIZE)
            ];
        };

        // Calculate squared distance from camera chunk to target chunk
        const calculateChunkDistance = (
            cameraChunkX: number,
            cameraChunkZ: number,
            targetChunkX: number,
            targetChunkZ: number
        ): number => {
            const dx = targetChunkX - cameraChunkX;
            const dz = targetChunkZ - cameraChunkZ;
            return dx * dx + dz * dz;
        };

        // Enqueue a chunk for loading, maintaining distance-based priority
        const enqueueChunkLoad = (
            chunkX: number,
            chunkZ: number,
            cameraChunkX: number,
            cameraChunkZ: number
        ): void => {
            // Skip if already in queue
            if (loadQueue.some(item => item.chunkX === chunkX && item.chunkZ === chunkZ)) {
                return;
            }
            
            const distanceSquared = calculateChunkDistance(
                cameraChunkX,
                cameraChunkZ,
                chunkX,
                chunkZ
            );
            
            // Insert in sorted order (closest first)
            const insertIdx = loadQueue.findIndex(
                item => distanceSquared < item.distanceSquared
            );
            
            if (insertIdx === -1) {
                loadQueue.push({ chunkX, chunkZ, distanceSquared });
            } else {
                loadQueue.splice(insertIdx, 0, { chunkX, chunkZ, distanceSquared });
            }
        };

        // Process the load queue, respecting MAX_CONCURRENT_LOADS limit
        const processLoadQueue = (): void => {
            // Start new loads only if we're below the concurrent limit
            while (loadingChunks.size < MAX_CONCURRENT_LOADS && loadQueue.length > 0) {
                const item = loadQueue.shift();
                if (!item) break;
                
                const key = getChunkKey(item.chunkX, item.chunkZ);
                
                // Skip if already loaded, blacklisted, or currently loading
                if (
                    loadedChunks.has(key) ||
                    blacklistedChunks.has(key) ||
                    loadingChunks.has(key)
                ) {
                    continue;
                }
                
                // Skip if failed with active cooldown
                const failTime = failedChunks.get(key);
                if (failTime !== undefined && Date.now() < failTime) {
                    // Re-enqueue to try again later
                    loadQueue.push(item);
                    continue;
                }
                
                // Start the load
                loadChunk(item.chunkX, item.chunkZ);
            }
        };

        // Decode binary terrain data (.NET format)
        const decodeBinaryTerrain = (buffer: ArrayBuffer, chunkX: number, chunkZ: number): WorldChunk => {
            const view = new DataView(buffer);
            let offset = 0;

            // Read version (1 byte) - kept for format validation
            view.getUint8(offset);
            offset += 1;

            // Read resolution (2 bytes, ushort, little-endian)
            const resolution = view.getUint16(offset, true);
            offset += 2;

            // Read minElevation (8 bytes, double, little-endian) - kept for validation
            view.getFloat64(offset, true);
            offset += 8;

            // Read maxElevation (8 bytes, double, little-endian) - kept for validation
            view.getFloat64(offset, true);
            offset += 8;

            // Calculate expected height count: (resolution + 1) * (resolution + 1)
            const gridSize = resolution + 1;
            const heightCount = gridSize * gridSize;
            const expectedBufferSize = 19 + heightCount * 4; // 1 + 2 + 8 + 8 + heights

            // Validate buffer size
            if (buffer.byteLength !== expectedBufferSize) {
                throw new Error(
                    `Buffer size mismatch for chunk ${chunkX},${chunkZ}: ` +
                    `got ${buffer.byteLength} bytes, expected ${expectedBufferSize} bytes ` +
                    `(resolution=${resolution}, gridSize=${gridSize}, heightCount=${heightCount})`
                );
            }

            // Read heights array ((resolution + 1) * (resolution + 1) * 4 bytes each, float32, little-endian)
            const heights = new Float32Array(heightCount);
            for (let i = 0; i < heightCount; i++) {
                const height = view.getFloat32(offset, true);
                
                // Validate height value
                if (!isFinite(height)) {
                    console.error(
                        `Invalid height value at index ${i} in chunk ${chunkX},${chunkZ}: ${height} ` +
                        `(NaN or Infinity detected)`
                    );
                }
                
                heights[i] = height;
                offset += 4;
            }

            return {
                chunkX,
                chunkZ,
                terrain: {
                    resolution,
                    heights: Array.from(heights)
                },
                roads: [],
                rivers: []
            };
        };

        // Fetch chunk (single attempt, no polling)
        const fetchChunkOnce = async (
            chunkX: number,
            chunkZ: number,
            abortSignal: AbortSignal
        ): Promise<WorldChunk | null> => {
            const key = getChunkKey(chunkX, chunkZ);
            const worldVersion = 'world-v1'; // TODO: Make this configurable
            const resolution = 64; // TODO: Make this configurable
            const url = `${process.env.REACT_APP_API_URL}/world/${worldVersion}/terrain/${resolution}/${chunkX}/${chunkZ}`;

            if (process.env.NODE_ENV === 'development') {
                console.log(`[Chunk] Fetching: ${key}`);
            }

            const res = await fetch(url, { signal: abortSignal });

            if (res.status === 200) {
                // Chunk ready - read binary data
                const buffer = await res.arrayBuffer();
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[Chunk] Ready (200): ${key}`);
                }
                return decodeBinaryTerrain(buffer, chunkX, chunkZ);
            } else if (res.status === 202) {
                // Chunk still generating - schedule retry
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[Chunk] Still generating (202), retry in ${RETRY_DELAY_MS}ms: ${key}`);
                }
                pendingRetryChunks.set(key, Date.now() + RETRY_DELAY_MS);
                return null;
            } else {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        };

        const buildTerrainMesh = (chunk: WorldChunk): THREE.Mesh => {
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
            const material = DEBUG_VISUALS
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
            if (DEBUG_VISUALS) {
                // Avoid frustum culling while debugging chunk visibility
                mesh.frustumCulled = false;
            }

            mesh.position.set(
                chunk.chunkX * CHUNK_SIZE,
                0,
                chunk.chunkZ * CHUNK_SIZE
            );

            return mesh;
        };

        const loadChunk = async (chunkX: number, chunkZ: number) => {
            const key = getChunkKey(chunkX, chunkZ);
            
            // Skip if permanently blacklisted (decode/build errors)
            if (blacklistedChunks.has(key)) return;
            
            // Skip if already loaded or currently loading
            if (loadedChunks.has(key) || loadingChunks.has(key)) return;
            
            // Skip if failed (network/fetch) and cooldown not expired
            const failTime = failedChunks.get(key);
            if (failTime !== undefined && Date.now() < failTime) return;

            loadingChunks.add(key);
            
            // Remove from failed chunks when retrying
            failedChunks.delete(key);
            
            // Remove from pending retry since we're attempting load now
            pendingRetryChunks.delete(key);
            
            // Create AbortController for this request
            const abortController = new AbortController();
            abortControllers.set(key, abortController);
            
            logStateTransition(key, 'idle', 'fetching');

            try {
                const data = await fetchChunkOnce(chunkX, chunkZ, abortController.signal);
                
                // If null, chunk returned 202 and is scheduled for retry
                if (data === null) {
                    logStateTransition(key, 'fetching', 'pending-retry');
                    loadingChunks.delete(key);
                    abortControllers.delete(key);
                    // Process queue after this load completes to start next one
                    processLoadQueue();
                    return;
                }
                
                // Double-check chunk wasn't unloaded while waiting
                if (!loadingChunks.has(key)) {
                    loadingChunks.delete(key);
                    abortControllers.delete(key);
                    processLoadQueue();
                    return;
                }
                
                try {
                    const mesh = buildTerrainMesh(data);
                    logStateTransition(key, 'fetching', 'mesh-built');
                    
                    // Store chunk coordinates in userData for debug material switching
                    mesh.userData.chunkX = data.chunkX;
                    mesh.userData.chunkZ = data.chunkZ;
                    
                    // Store the mesh in the map
                    loadedChunks.set(key, mesh);
                    scene.add(mesh);
                    logStateTransition(key, 'mesh-built', 'loaded');
                } catch (meshError) {
                    // Mesh build failed - permanently blacklist this chunk
                    console.error(`[Chunk] MESH BUILD FAILED for ${key}:`, meshError);
                    blacklistedChunks.add(key);
                    logStateTransition(key, 'fetching', 'blacklisted (mesh-build-error)');
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    // Silently ignore abort
                    logStateTransition(key, 'fetching', 'aborted');
                } else if (error instanceof Error && error.message.includes('Buffer size mismatch')) {
                    // Decode/validation error - permanently blacklist
                    console.error(`[Chunk] DECODE FAILED for ${key}:`, error.message);
                    blacklistedChunks.add(key);
                    logStateTransition(key, 'fetching', 'blacklisted (decode-error)');
                } else {
                    // Network/fetch error - set cooldown for retry
                    console.error(`[Chunk] FETCH FAILED for ${key}:`, error);
                    failedChunks.set(key, Date.now() + FAILED_CHUNK_COOLDOWN_MS);
                    logStateTransition(key, 'fetching', 'failed (retry in 5s)');
                }
            } finally {
                loadingChunks.delete(key);
                abortControllers.delete(key);
                // Process queue to start the next load
                processLoadQueue();
            }
        };

        const unloadChunk = (chunkX: number, chunkZ: number) => {
            const key = getChunkKey(chunkX, chunkZ);
            
            // Cancel any in-flight request
            const abortController = abortControllers.get(key);
            if (abortController) {
                abortController.abort();
                abortControllers.delete(key);
            }
            
            // Remove from all tracking maps
            loadingChunks.delete(key);
            pendingRetryChunks.delete(key);
            failedChunks.delete(key);
            blacklistedChunks.delete(key);
            
            // Get and remove mesh
            const mesh = loadedChunks.get(key);
            if (!mesh) return;

            // Remove from scene
            scene.remove(mesh);

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
            loadedChunks.delete(key);
        };

        const updateChunks = () => {
            const now = Date.now();
            
            const [cameraChunkX, cameraChunkZ] = getChunkCoords(
                camera.position.x,
                camera.position.z
            );
            
            // Determine which chunks should be loaded within LOAD_RADIUS
            const enqueuedThisUpdate = new Set<string>();

            for (let x = cameraChunkX - LOAD_RADIUS; x <= cameraChunkX + LOAD_RADIUS; x++) {
                for (let z = cameraChunkZ - LOAD_RADIUS; z <= cameraChunkZ + LOAD_RADIUS; z++) {
                    const key = getChunkKey(x, z);
                    
                    // Skip if permanently blacklisted
                    if (blacklistedChunks.has(key)) continue;
                    
                    // Skip if already processed this update
                    if (enqueuedThisUpdate.has(key)) continue;
                    
                    // Skip if already loaded or currently loading
                    if (loadedChunks.has(key) || loadingChunks.has(key)) continue;
                    
                    // Skip if already in load queue
                    if (loadQueue.some(item => item.chunkX === x && item.chunkZ === z)) {
                        continue;
                    }
                    
                    // Skip if failed (network) and cooldown not expired
                    const failTime = failedChunks.get(key);
                    if (failTime !== undefined && now < failTime) continue;
                    
                    // Check if pending retry and not yet time to retry
                    const nextRetryTime = pendingRetryChunks.get(key);
                    if (nextRetryTime !== undefined && now < nextRetryTime) continue;
                    
                    enqueuedThisUpdate.add(key);
                    enqueueChunkLoad(x, z, cameraChunkX, cameraChunkZ);
                }
            }

            // Process pending retries that are now ready
            pendingRetryChunks.forEach((nextRetryTime, key) => {
                if (now >= nextRetryTime && !enqueuedThisUpdate.has(key)) {
                    const [chunkX, chunkZ] = key.split(',').map(Number);
                    enqueuedThisUpdate.add(key);
                    enqueueChunkLoad(chunkX, chunkZ, cameraChunkX, cameraChunkZ);
                    // Remove from pendingRetryChunks so it goes through normal loading flow
                    pendingRetryChunks.delete(key);
                }
            });

            // Unload chunks outside UNLOAD_RADIUS (hysteresis prevents oscillation)
            const chunksToUnload: Array<[number, number]> = [];
            loadedChunks.forEach((mesh: THREE.Mesh, key: string) => {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                const dx = Math.abs(chunkX - cameraChunkX);
                const dz = Math.abs(chunkZ - cameraChunkZ);
                
                if (dx > UNLOAD_RADIUS || dz > UNLOAD_RADIUS) {
                    chunksToUnload.push([chunkX, chunkZ]);
                }
            });

            chunksToUnload.forEach(([x, z]) => unloadChunk(x, z));

            // Start processing the load queue
            processLoadQueue();
        };


        const keys: Record<string, boolean> = {};

        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            keys[key] = true;
            
            // Toggle debug visuals on 'G' key
            if (key === 'g' && !document.pointerLockElement) {
                DEBUG_VISUALS = !DEBUG_VISUALS;
                updateDebugVisuals();
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[Debug] DEBUG_VISUALS toggled: ${DEBUG_VISUALS}`);
                }
            }
            
            // Copy coordinates to clipboard on 'C' key
            if (key === 'c' && !document.pointerLockElement) {
                const originLatRad = ORIGIN_LATITUDE * (Math.PI / 180);
                const metersPerDegreeLon = METERS_PER_DEGREE_LATITUDE * Math.cos(originLatRad);
                
                const latitude = ORIGIN_LATITUDE + (camera.position.z / METERS_PER_DEGREE_LATITUDE);
                const longitude = ORIGIN_LONGITUDE + (camera.position.x / metersPerDegreeLon);
                
                const coordText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                navigator.clipboard.writeText(coordText).then(() => {
                    // Visual feedback: temporarily change HUD color
                    const origColor = hudOverlay.style.color;
                    hudOverlay.style.color = '#ffff00';
                    setTimeout(() => {
                        hudOverlay.style.color = origColor;
                    }, 200);
                }).catch(err => console.error('Failed to copy:', err));
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keys[e.key.toLowerCase()] = false;
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        // Pointer lock for mouse look
        const handlePointerLockChange = () => {
            // Optional: add UI feedback here
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (document.pointerLockElement === renderer.domElement) {
                const sensitivity = 0.002;
                
                yaw -= e.movementX * sensitivity;
                pitch -= e.movementY * sensitivity;
                
                // Clamp pitch to prevent camera flipping
                pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
                
                // Apply rotation to camera
                camera.rotation.order = 'YXZ';
                camera.rotation.y = yaw;
                camera.rotation.x = pitch;
            }
        };

        const handleClick = () => {
            renderer.domElement.requestPointerLock();
        };

        renderer.domElement.addEventListener('click', handleClick);
        document.addEventListener('pointerlockchange', handlePointerLockChange);
        document.addEventListener('mousemove', handleMouseMove);

        const animate = () => {
            requestAnimationFrame(animate);

            // Update developer HUD overlay
            const [camChunkX, camChunkZ] = getChunkCoords(camera.position.x, camera.position.z);
            const originLatRad = ORIGIN_LATITUDE * (Math.PI / 180);
            const metersPerDegreeLon = METERS_PER_DEGREE_LATITUDE * Math.cos(originLatRad);
            
            const latitude = ORIGIN_LATITUDE + (camera.position.z / METERS_PER_DEGREE_LATITUDE);
            const longitude = ORIGIN_LONGITUDE + (camera.position.x / metersPerDegreeLon);
            
            const pointerLocked = document.pointerLockElement === renderer.domElement;
            hudOverlay.textContent = 
                `LAT: ${latitude.toFixed(6)}\n` +
                `LON: ${longitude.toFixed(6)}\n` +
                `Chunk: [${camChunkX}, ${camChunkZ}]\n` +
                `World: [${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)}]\n` +
                `Queue: ${loadQueue.length} | Loading: ${loadingChunks.size}/${MAX_CONCURRENT_LOADS}\n` +
                `\n${pointerLocked ? 'ESC: unlock | then C: copy coords | G: debug' : 'C: copy coords | G: debug [' + (DEBUG_VISUALS ? 'ON' : 'off') + '] | Click: lock'}`;

            // Clamp camera height to be above terrain
            const [cameraChunkX, cameraChunkZ] = getChunkCoords(
                camera.position.x,
                camera.position.z
            );
            const cameraChunkKey = getChunkKey(cameraChunkX, cameraChunkZ);
            const terrainMesh = loadedChunks.get(cameraChunkKey);
            if (terrainMesh && terrainMesh.geometry) {
                const geometry = terrainMesh.geometry as THREE.PlaneGeometry;
                if (geometry.boundingBox) {
                    // Get the terrain's Y range (already includes heightScale multiplier)
                    const terrainMaxY = terrainMesh.position.y + geometry.boundingBox.max.y;
                    const cameraMinY = terrainMaxY + 2; // 2 units above terrain surface
                    if (camera.position.y < cameraMinY) {
                        camera.position.y = cameraMinY;
                    }
                }
            }

            // Calculate movement vectors based on camera direction
            const forward = new THREE.Vector3();
            const right = new THREE.Vector3();
            
            // Get camera's forward direction (projected onto XZ plane for horizontal movement)
            camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();
            
            // Get right direction (perpendicular to forward)
            right.crossVectors(forward, camera.up).normalize();

            const baseSpeed = 1;
            const sprintMultiplier = keys['shift'] ? 2.5 : 1;
            const speed = baseSpeed * sprintMultiplier;

            // Movement relative to camera direction
            if (keys['w']) {
                camera.position.addScaledVector(forward, speed);
            }
            if (keys['s']) {
                camera.position.addScaledVector(forward, -speed);
            }
            if (keys['a']) {
                camera.position.addScaledVector(right, -speed);
            }
            if (keys['d']) {
                camera.position.addScaledVector(right, speed);
            }

            // Vertical movement
            if (keys[' ']) {
                camera.position.y += speed;
            }
            if (keys['control']) {
                camera.position.y -= speed;
            }

            renderer.render(scene, camera);
        };

        // Start updateChunks on a fixed interval (decoupled from render loop)
        updateChunksIntervalId = setInterval(() => {
            updateChunks();
        }, UPDATE_CHUNKS_INTERVAL_MS);

        animate();
        
        return () => {
            // Clear the update interval
            if (updateChunksIntervalId !== null) {
                clearInterval(updateChunksIntervalId);
                updateChunksIntervalId = null;
            }
            
            // Cleanup event listeners
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            renderer.domElement.removeEventListener('click', handleClick);
            document.removeEventListener('pointerlockchange', handlePointerLockChange);
            document.removeEventListener('mousemove', handleMouseMove);
            
            // Exit pointer lock if active
            if (document.pointerLockElement === renderer.domElement) {
                document.exitPointerLock();
            }
            
            // Cleanup HUD overlay
            if (hudOverlay.parentNode) {
                document.body.removeChild(hudOverlay);
            }
            
            // Cancel all in-flight requests
            abortControllers.forEach(controller => controller.abort());
            abortControllers.clear();
            
            // Clear load queue
            loadQueue.length = 0;
            
            // Cleanup: unload all chunks
            const allChunks = Array.from(loadedChunks.keys());
            allChunks.forEach((key: string) => {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                unloadChunk(chunkX, chunkZ);
            });
            
            renderer.dispose();
            mount.removeChild(renderer.domElement);
        };

    }, []);

    return <div ref={mountRef} />;
}
