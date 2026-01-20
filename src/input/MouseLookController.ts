import {WebGLRenderer, Camera} from 'three';

export class MouseLookController {
    private yaw = 0;
    private pitch = 0;
    private maxPitch = Math.PI / 2 - 0.1;
    private renderer: WebGLRenderer;

    constructor(renderer: WebGLRenderer) {
        this.renderer = renderer;
        this.renderer.domElement.addEventListener('click', this.handleClick);
        document.addEventListener('pointerlockchange', this.handlePointerLockChange);
        document.addEventListener('mousemove', this.handleMouseMove);
    }

    private handlePointerLockChange = () => {
        // Optional: add UI feedback here
    };

    private handleMouseMove = (e: MouseEvent) => {
        if (document.pointerLockElement === this.renderer.domElement) {
            const sensitivity = 0.002;
            
            this.yaw -= e.movementX * sensitivity;
            this.pitch -= e.movementY * sensitivity;
            
            // Clamp pitch to prevent camera flipping
            this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch));
        }
    };

    private handleClick = () => {
        this.renderer.domElement.requestPointerLock();
    };

    public applyToCamera(camera: Camera): void {
        camera.rotation.order = 'YXZ';
        camera.rotation.y = this.yaw;
        camera.rotation.x = this.pitch;
    }

    public destroy(): void {
        this.renderer.domElement.removeEventListener('click', this.handleClick);
        document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
        document.removeEventListener('mousemove', this.handleMouseMove);
        
        // Exit pointer lock if active
        if (document.pointerLockElement === this.renderer.domElement) {
            document.exitPointerLock();
        }
    }
}
