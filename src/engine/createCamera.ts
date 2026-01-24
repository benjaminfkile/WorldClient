import * as THREE from "three";

export function createCamera(initialPosition?: { x: number; z: number }): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        100000  // Extended far plane for distant terrain
    );

    const cameraHeight = 50;
    const spawnX = initialPosition?.x ?? 0;
    const spawnZ = initialPosition?.z ?? 100;

    // Set up vector (which way is up)
    camera.up.set(0, 1, 0);
    
    // Set position
    camera.position.set(spawnX, cameraHeight, spawnZ);
    
    // Reset rotation to identity (looking forward along -Z axis)
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    
    // Rebuild camera matrix
    camera.updateMatrix();
    camera.updateMatrixWorld();

    return camera;
}
