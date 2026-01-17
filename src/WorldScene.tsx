import * as THREE from "three";
import { JSX, useEffect, useRef } from "react";
import { WorldChunk } from "./types";

const CHUNK_SIZE = 100;

export default function WorldScene(): JSX.Element {
    const mountRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!mountRef.current) return;

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
        mountRef.current.appendChild(renderer.domElement);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(100, 200, 100);
        scene.add(light);

        const loadedChunks = new Set<string>();

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
            const key = `${chunkX},${chunkZ}`;
            if (loadedChunks.has(key)) return;

            loadedChunks.add(key);

            const data = await fetchChunk(chunkX, chunkZ);
            const mesh = buildTerrainMesh(data);
            scene.add(mesh);
        };

        // Initial 3x3 grid
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                loadChunk(x, z);
            }
        }

        const keys: Record<string, boolean> = {};

        window.addEventListener("keydown", e => (keys[e.key] = true));
        window.addEventListener("keyup", e => (keys[e.key] = false));

        const animate = () => {
            requestAnimationFrame(animate);

            const speed = 1;
            if (keys["w"]) camera.position.z -= speed;
            if (keys["s"]) camera.position.z += speed;
            if (keys["a"]) camera.position.x -= speed;
            if (keys["d"]) camera.position.x += speed;

            renderer.render(scene, camera);
        };

        animate();

        return () => {
            renderer.dispose();
            mountRef.current?.removeChild(renderer.domElement);
        };
    }, []);

    return <div ref={mountRef} />;
}
