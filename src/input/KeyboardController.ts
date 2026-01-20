import * as THREE from "three";

export class KeyboardController {
    private keys: Record<string, boolean> = {};

    constructor() {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        this.keys[key] = true;
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        this.keys[e.key.toLowerCase()] = false;
    };

    public updateCameraPosition(camera: THREE.Camera): void {
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
        const sprintMultiplier = this.keys['shift'] ? 2.5 : 1;
        const speed = baseSpeed * sprintMultiplier;

        // Movement relative to camera direction
        if (this.keys['w']) {
            camera.position.addScaledVector(forward, speed);
        }
        if (this.keys['s']) {
            camera.position.addScaledVector(forward, -speed);
        }
        if (this.keys['a']) {
            camera.position.addScaledVector(right, -speed);
        }
        if (this.keys['d']) {
            camera.position.addScaledVector(right, speed);
        }

        // Vertical movement
        if (this.keys[' ']) {
            camera.position.y += speed;
        }
        if (this.keys['control']) {
            camera.position.y -= speed;
        }
    }

    public isKeyPressed(key: string): boolean {
        return this.keys[key.toLowerCase()] || false;
    }

    public destroy(): void {
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
    }
}
