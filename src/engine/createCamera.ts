import * as THREE from "three";

export function createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        100000  // Extended far plane for distant terrain
    );

    camera.position.set(0, 50, 100);
    // Ensure we're looking toward the origin initially so ground is in view
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    return camera;
}
