import * as THREE from "three";
import { JSX, useEffect, useRef } from "react";
import { WorldChunk } from "./types";

const CHUNK_SIZE = 100;
const LOAD_RADIUS = 4; // Load chunks within this radius (in chunks)

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
            10000
        );

        camera.position.set(0, 50, 100);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        mount.appendChild(renderer.domElement);

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

        const getChunkKey = (chunkX: number, chunkZ: number): string => {
            return `${chunkX},${chunkZ}`;
        };

        const getChunkCoords = (worldX: number, worldZ: number): [number, number] => {
            return [
                Math.floor(worldX / CHUNK_SIZE),
                Math.floor(worldZ / CHUNK_SIZE)
            ];
        };

        const fetchChunk = async (
            chunkX: number,
            chunkZ: number
        ): Promise<WorldChunk> => {
            const res = await fetch(
                `${process.env.REACT_APP_API_URL}/api/world/chunks/${chunkX}/${chunkZ}`
            );
            return res.json();
        };

        const buildTerrainMesh = (chunk: WorldChunk): THREE.Mesh => {
            const { resolution, heights } = chunk.terrain;

            const geometry = new THREE.PlaneGeometry(
                CHUNK_SIZE,
                CHUNK_SIZE,
                resolution - 1,
                resolution - 1
            );

            geometry.rotateX(-Math.PI / 2);

            const positions = geometry.attributes.position as THREE.BufferAttribute;

            for (let i = 0; i < positions.count; i++) {
                positions.setY(i, heights[i]);
            }

            geometry.computeVertexNormals();

            //   const material = new THREE.MeshStandardMaterial({
            //     color: 0x55aa55,
            //     flatShading: true,
            //   });

            const material = new THREE.MeshStandardMaterial({
                color:
                    (chunk.chunkX + chunk.chunkZ) % 2 === 0
                        ? 0x55aa55
                        : 0x448844,
                flatShading: true,
            });


            const mesh = new THREE.Mesh(geometry, material);

            mesh.position.set(
                chunk.chunkX * CHUNK_SIZE,
                0,
                chunk.chunkZ * CHUNK_SIZE
            );

            return mesh;
        };

        const loadChunk = async (chunkX: number, chunkZ: number) => {
            const key = getChunkKey(chunkX, chunkZ);
            
            // Skip if already loaded or currently loading
            if (loadedChunks.has(key) || loadingChunks.has(key)) return;

            loadingChunks.add(key);

            try {
                const data = await fetchChunk(chunkX, chunkZ);
                const mesh = buildTerrainMesh(data);
                
                // Store the mesh in the map
                loadedChunks.set(key, mesh);
                scene.add(mesh);
            } catch (error) {
                console.error(`Failed to load chunk ${key}:`, error);
            } finally {
                loadingChunks.delete(key);
            }
        };

        const unloadChunk = (chunkX: number, chunkZ: number) => {
            const key = getChunkKey(chunkX, chunkZ);
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
                    mesh.material.forEach(mat => mat.dispose());
                } else {
                    mesh.material.dispose();
                }
            }

            // Remove from map
            loadedChunks.delete(key);
        };

        const updateChunks = () => {
            const [cameraChunkX, cameraChunkZ] = getChunkCoords(
                camera.position.x,
                camera.position.z
            );

            // Determine which chunks should be loaded
            const chunksToLoad: Array<[number, number]> = [];
            for (let x = cameraChunkX - LOAD_RADIUS; x <= cameraChunkX + LOAD_RADIUS; x++) {
                for (let z = cameraChunkZ - LOAD_RADIUS; z <= cameraChunkZ + LOAD_RADIUS; z++) {
                    const key = getChunkKey(x, z);
                    if (!loadedChunks.has(key) && !loadingChunks.has(key)) {
                        chunksToLoad.push([x, z]);
                    }
                }
            }

            // Load missing chunks
            chunksToLoad.forEach(([x, z]) => loadChunk(x, z));

            // Unload chunks outside the radius
            const chunksToUnload: Array<[number, number]> = [];
            loadedChunks.forEach((mesh, key) => {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                const dx = Math.abs(chunkX - cameraChunkX);
                const dz = Math.abs(chunkZ - cameraChunkZ);
                
                if (dx > LOAD_RADIUS || dz > LOAD_RADIUS) {
                    chunksToUnload.push([chunkX, chunkZ]);
                }
            });

            chunksToUnload.forEach(([x, z]) => unloadChunk(x, z));
        };


        const keys: Record<string, boolean> = {};

        const handleKeyDown = (e: KeyboardEvent) => {
            keys[e.key.toLowerCase()] = true;
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

            // Update chunks based on camera position
            updateChunks();

            renderer.render(scene, camera);
        };

        animate();
        
        return () => {
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
            
            // Cleanup: unload all chunks
            const allChunks = Array.from(loadedChunks.keys());
            allChunks.forEach(key => {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                unloadChunk(chunkX, chunkZ);
            });
            
            renderer.dispose();
            mount.removeChild(renderer.domElement);
        };

    }, []);

    return <div ref={mountRef} />;
}
