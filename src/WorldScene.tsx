import * as THREE from "three";
import { JSX, useEffect, useRef, useState } from "react";
import MapWindow from "./MapWindow";
import { createScene } from "./engine/createScene";
import { createCamera } from "./engine/createCamera";
import { createRenderer } from "./engine/createRenderer";
import { createLighting } from "./engine/lighting";
import { KeyboardController } from "./input/KeyboardController";
import { MouseLookController } from "./input/MouseLookController";
import { ChunkManager } from "./chunks/ChunkManager";
import { DebugHUD } from "./debug/DebugHUD";
import { DebugVisuals } from "./debug/DebugVisuals";

const CHUNK_SIZE = 100;
let DEBUG_VISUALS = false; // Toggle temporary debug helpers/materials (press 'G' to toggle)
const UPDATE_CHUNKS_INTERVAL_MS = 250; // Update chunk visibility every ~250ms (4 times/sec)
const MAX_CONCURRENT_LOADS = 20; // Never exceed this many simultaneous fetches

// Geo-coordinate system for developer readout
const ORIGIN_LATITUDE = 46.8721;
const ORIGIN_LONGITUDE = -113.994;
const METERS_PER_DEGREE_LATITUDE = 111320;
// World X increases east (longitude), World Z increases north (latitude)
// One world unit equals one meter

export default function WorldScene(props: { onCoordsUpdate?: (coords: { latitude: number; longitude: number }) => void }): JSX.Element {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [mapVisible, setMapVisible] = useState(true);
    const [currentCoords, setCurrentCoords] = useState({ latitude: ORIGIN_LATITUDE, longitude: ORIGIN_LONGITUDE });

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
        
        // Initialize core systems
        const scene = createScene();
        const camera = createCamera();
        const renderer = createRenderer(mount);
        createLighting(scene);

        // Initialize controllers
        const keyboardController = new KeyboardController();
        const mouseLookController = new MouseLookController(renderer);
        const chunkManager = new ChunkManager(scene, DEBUG_VISUALS);
        const debugHUD = new DebugHUD();
        const debugVisuals = new DebugVisuals(scene);
        
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
                    console.log(`[Debug] DEBUG_VISUALS toggled: ${DEBUG_VISUALS}`);
                }
            }

            // Toggle map on 'M' key
            if (key === 'm' && !document.pointerLockElement) {
                setMapVisible(prev => !prev);
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[Debug] Map toggled`);
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
            props.onCoordsUpdate?.(coords);
            setCurrentCoords(coords);
            
            // Clamp camera height to be above terrain
            const [cameraChunkX, cameraChunkZ] = [
                Math.floor(camera.position.x / CHUNK_SIZE),
                Math.floor(camera.position.z / CHUNK_SIZE)
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

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'fixed', top: 0, left: 0, zIndex: 0 }} />
            <MapWindow latitude={currentCoords.latitude} longitude={currentCoords.longitude} />
        </>
    );
}
