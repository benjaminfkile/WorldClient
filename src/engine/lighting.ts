import * as THREE from "three";

export function createLighting(scene: THREE.Scene): void {
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(100, 200, 100);
    scene.add(light);
}
