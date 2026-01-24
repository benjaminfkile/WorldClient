import * as THREE from "three";
import { JSX, useEffect, useRef, useState } from "react";
import MapWindow from "./MapWindow";
import { CoordinateInput } from "./ui/CoordinateInput";
import { createScene } from "./engine/createScene";
import { createCamera } from "./engine/createCamera";
import { createRenderer } from "./engine/createRenderer";
import { createLighting } from "./engine/lighting";
import { KeyboardController } from "./input/KeyboardController";
import { MouseLookController } from "./input/MouseLookController";
import { ChunkManager } from "./chunks/ChunkManager";
import { DebugHUD } from "./debug/DebugHUD";
import { DebugVisuals } from "./debug/DebugVisuals";
import { useWorldBootstrap } from "./WorldBootstrapContext";
import { worldMetersToLatLon, latLonToWorldMeters, worldMetersToChunkCoords } from "./world/worldMath";
import { readSpawnCoordinates } from "./world/spawnCoordinates";

let DEBUG_VISUALS = false; // Toggle temporary debug helpers/materials (press 'G' to toggle)
const UPDATE_CHUNKS_INTERVAL_MS = 250; // Update chunk visibility every ~250ms (4 times/sec)
const MAX_CONCURRENT_LOADS = 20; // Never exceed this many simultaneous fetches

// World X increases east (longitude), World Z increases north (latitude)
// One world unit equals one meter

export default function WorldScene(props: { onCoordsUpdate?: (coords: { latitude: number; longitude: number }) => void }): JSX.Element {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const chunkManagerRef = useRef<ChunkManager | null>(null);
    const [mapVisible, setMapVisible] = useState(true);
    const [currentCoords, setCurrentCoords] = useState({ latitude: 0, longitude: 0 });
    const { activeWorldVersion, worldContract, isLoading, error } = useWorldBootstrap();
    const { onCoordsUpdate } = props;

    // Handle navigation to new coordinates
    const handleNavigate = (worldX: number, worldZ: number) => {
        if (cameraRef.current) {
            cameraRef.current.position.x = worldX;
            cameraRef.current.position.z = worldZ;
        }
        if (chunkManagerRef.current) {
            chunkManagerRef.current.update({ x: worldX, y: 50, z: worldZ } as THREE.Vector3);
        }
    };

    // Control map container visibility
    useEffect(() => {
        const container = document.getElementById('map-container-world-map');
        if (container) {
            container.style.display = mapVisible ? 'block' : 'none';
        }
    }, [mapVisible]);

    // Scene lifecycle (mount once)
    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;
        
        // Gate rendering: wait for bootstrap to complete
        if (isLoading) {
            return;
        }

        // Fail hard if bootstrap errored
        if (error || !activeWorldVersion || !worldContract) {
            console.error('[WorldScene] Bootstrap failed - cannot proceed:', {
                error,
                hasVersion: !!activeWorldVersion,
                hasContract: !!worldContract
            });
            return;
        }
        
        const chunkSize = worldContract.chunkSizeMeters;

        // Read and validate spawn coordinates
        let spawnWorldX = 0;
        let spawnWorldZ = 0;
        let spawnChunkX = 0;
        let spawnChunkZ = 0;
        
        try {
            const spawnCoords = readSpawnCoordinates();
            const worldMeters = latLonToWorldMeters(spawnCoords.latitude, spawnCoords.longitude, worldContract);
            spawnWorldX = worldMeters.worldX;
            spawnWorldZ = worldMeters.worldZ;
            
            const chunkCoords = worldMetersToChunkCoords(spawnWorldX, spawnWorldZ, worldContract);
            spawnChunkX = chunkCoords.chunkX;
            spawnChunkZ = chunkCoords.chunkZ;

            console.log('[WorldScene] World spawn initialized');
            console.log(`  Spawn lat/lon: (${spawnCoords.latitude.toFixed(4)}, ${spawnCoords.longitude.toFixed(4)})`);
            console.log(`  World meters: (X=${spawnWorldX.toFixed(1)}, Z=${spawnWorldZ.toFixed(1)})`);
            console.log(`  Chunk coords: (X=${spawnChunkX}, Z=${spawnChunkZ})`);
            console.log(`  World origin: (${worldContract.origin.latitude.toFixed(4)}, ${worldContract.origin.longitude.toFixed(4)})`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[WorldScene] Failed to read spawn coordinates:', errorMsg);
            console.log('[WorldScene] Spawning at world origin (0, 0)');
            spawnWorldX = 0;
            spawnWorldZ = 0;
            spawnChunkX = 0;
            spawnChunkZ = 0;
        }
        
        // Initialize core systems
        const scene = createScene();
        const camera = createCamera({ x: spawnWorldX, z: spawnWorldZ });
        cameraRef.current = camera;
        const renderer = createRenderer(mount);
        createLighting(scene);

        // Initialize controllers
        const keyboardController = new KeyboardController();
        const mouseLookController = new MouseLookController(renderer);
        const chunkManager = new ChunkManager(scene, DEBUG_VISUALS, activeWorldVersion, worldContract);
        chunkManagerRef.current = chunkManager;
        const debugHUD = new DebugHUD(worldContract);
        const debugVisuals = new DebugVisuals(scene, worldContract);
        
        // Initialize debug visuals if enabled
        if (DEBUG_VISUALS) {
            debugVisuals.setVisible(true);
        }

        // Interval for processing chunk updates
        let updateChunksIntervalId: NodeJS.Timeout | null = null;

        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            
            // Toggle debug visuals on 'G' key
            if (key === 'g' && !document.pointerLockElement) {
                DEBUG_VISUALS = !DEBUG_VISUALS;
                debugVisuals.setVisible(DEBUG_VISUALS);
                chunkManager.setDebugVisuals(DEBUG_VISUALS);
                if (process.env.NODE_ENV === 'development') {
                    //console.log(`[Debug] DEBUG_VISUALS toggled: ${DEBUG_VISUALS}`);
                }
            }

            // Toggle map on 'M' key
            if (key === 'm' && !document.pointerLockElement) {
                setMapVisible(prev => !prev);
                if (process.env.NODE_ENV === 'development') {
                    //console.log(`[Debug] Map toggled`);
                }
            }
            
            // Copy coordinates to clipboard on 'C' key
            if (key === 'c' && !document.pointerLockElement) {
                const coords = worldMetersToLatLon(camera.position.x, camera.position.z, worldContract);
                const coordText = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
                navigator.clipboard.writeText(coordText).then(() => {
                    debugHUD.flashCopyFeedback();
                }).catch(err => console.error('Failed to copy:', err));
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        const animate = () => {
            requestAnimationFrame(animate);

            // Update controllers
            keyboardController.updateCameraPosition(camera);
            mouseLookController.applyToCamera(camera);

            // Update HUD and get coordinates
            const coords = debugHUD.update(
                camera.position,
                chunkManager.getLoadQueueSize(),
                chunkManager.getLoadingCount(),
                MAX_CONCURRENT_LOADS,
                DEBUG_VISUALS,
                mapVisible,
                document.pointerLockElement === renderer.domElement
            );
            
            // Update parent component with current coordinates
            onCoordsUpdate?.(coords);
            setCurrentCoords(coords);
            
            // Clamp camera height to be above terrain
            const [cameraChunkX, cameraChunkZ] = [
                Math.floor(camera.position.x / chunkSize),
                Math.floor(camera.position.z / chunkSize)
            ];
            const terrainMesh = chunkManager.getLoadedChunk(cameraChunkX, cameraChunkZ);
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

            renderer.render(scene, camera);
        };

        // Start updateChunks on a fixed interval (decoupled from render loop)
        updateChunksIntervalId = setInterval(() => {
            chunkManager.update(camera.position);
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
            
            // Cleanup controllers and managers
            keyboardController.destroy();
            mouseLookController.destroy();
            chunkManager.destroy();
            debugHUD.destroy();
            debugVisuals.destroy();
            
            renderer.dispose();
            mount.removeChild(renderer.domElement);
        };

    }, [activeWorldVersion, worldContract, isLoading, error, mapVisible, onCoordsUpdate]);

    return (
        <>
            {!isLoading && !error && (
                <CoordinateInput
                  currentLat={currentCoords.latitude}
                  currentLng={currentCoords.longitude}
                  worldContract={worldContract}
                  onNavigate={handleNavigate}
                />
            )}
            {isLoading && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#0a0a0a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    color: '#888888',
                    fontSize: '16px',
                    fontFamily: 'monospace',
                    animation: 'pulse 2s infinite'
                }}>
                    <style>{`
                        @keyframes pulse {
                            0%, 100% { opacity: 0.5; }
                            50% { opacity: 1; }
                        }
                    `}</style>
                    Initializing world...
                </div>
            )}
            {error && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#1a0a0a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    color: '#cc4444',
                    fontSize: '16px',
                    fontFamily: 'monospace',
                    padding: '20px',
                    textAlign: 'center'
                }}>
                    <div>
                        <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#ff6666' }}>Bootstrap Error</div>
                        <div>{error}</div>
                    </div>
                </div>
            )}
            <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'fixed', top: 0, left: 0, zIndex: 0 }} />
            {!isLoading && !error && <MapWindow latitude={currentCoords.latitude} longitude={currentCoords.longitude} />}
        </>
    );
}
