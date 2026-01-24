import * as THREE from "three";
import type { WorldContract } from "../WorldBootstrapContext";

const LOAD_RADIUS = parseInt(process.env.REACT_APP_LOAD_RADIUS ?? "10") || 10;

export class DebugVisuals {
    private scene: THREE.Scene;
    private debugMeshes: THREE.Object3D[] = [];
    private worldContract: WorldContract;

    constructor(scene: THREE.Scene, worldContract: WorldContract) {
        this.scene = scene;
        this.worldContract = worldContract;
    }

    public setVisible(visible: boolean): void {
        if (visible) {
            this.createDebugHelpers();
        } else {
            this.removeDebugHelpers();
        }
    }

    private createDebugHelpers(): void {
        // Remove existing helpers first
        this.removeDebugHelpers();

        const gridSize = this.worldContract.chunkSizeMeters * LOAD_RADIUS * 3;
        const gridDivisions = LOAD_RADIUS * 6;
        const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x888888);
        // Drop the grid slightly below y=0 to avoid z-fighting with terrain
        gridHelper.position.y = -0.1;
        gridHelper.renderOrder = -1;
        this.scene.add(gridHelper);
        this.debugMeshes.push(gridHelper);

        const axesHelper = new THREE.AxesHelper(100);
        this.scene.add(axesHelper);
        this.debugMeshes.push(axesHelper);

        const testCube = new THREE.Mesh(
            new THREE.BoxGeometry(10, 10, 10),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        testCube.position.set(0, 5, 0);
        this.scene.add(testCube);
        this.debugMeshes.push(testCube);
    }

    private removeDebugHelpers(): void {
        this.debugMeshes.forEach(mesh => {
            this.scene.remove(mesh);
        });
        this.debugMeshes = [];
    }

    public destroy(): void {
        this.removeDebugHelpers();
    }
}
