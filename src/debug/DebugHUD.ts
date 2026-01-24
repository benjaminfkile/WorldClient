import { Vector3 } from "three";
import type { WorldContract } from "../WorldBootstrapContext";
import { worldMetersToLatLon, worldMetersToChunkCoords } from "../world/worldMath";

export class DebugHUD {
    private hudOverlay: HTMLDivElement;
    private worldContract: WorldContract;

    constructor(worldContract: WorldContract) {
        this.worldContract = worldContract;
        this.hudOverlay = document.createElement('div');
        this.hudOverlay.style.position = 'fixed';
        this.hudOverlay.style.top = '10px';
        this.hudOverlay.style.left = '10px';
        this.hudOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        this.hudOverlay.style.color = '#00ff00';
        this.hudOverlay.style.fontFamily = 'monospace';
        this.hudOverlay.style.fontSize = '12px';
        this.hudOverlay.style.padding = '8px';
        this.hudOverlay.style.borderRadius = '4px';
        this.hudOverlay.style.zIndex = '100';
        this.hudOverlay.style.pointerEvents = 'none';
        this.hudOverlay.style.whiteSpace = 'pre-wrap';
        this.hudOverlay.style.lineHeight = '1.4';
        document.body.appendChild(this.hudOverlay);
    }

    public update(
        cameraPosition: Vector3,
        queueSize: number,
        loadingCount: number,
        maxConcurrentLoads: number,
        debugVisuals: boolean,
        mapVisible: boolean,
        pointerLocked: boolean
    ): { latitude: number; longitude: number } {
        const { chunkX, chunkZ } = worldMetersToChunkCoords(cameraPosition.x, cameraPosition.z, this.worldContract);
        const coords = worldMetersToLatLon(cameraPosition.x, cameraPosition.z, this.worldContract);
        
        this.hudOverlay.textContent = 
            `LAT: ${coords.latitude.toFixed(6)}\n` +
            `LON: ${coords.longitude.toFixed(6)}\n` +
            `Chunk: [${chunkX}, ${chunkZ}]\n` +
            `World: [${cameraPosition.x.toFixed(1)}, ${cameraPosition.z.toFixed(1)}]\n` +
            `Queue: ${queueSize} | Loading: ${loadingCount}/${maxConcurrentLoads}\n` +
            `\n` +
            `WASD/Arrow: move | Space: up | Ctrl: down\n` +
            `${pointerLocked ? 'ESC: unlock | C: copy | G: debug | M: map' : 'C: copy | G: debug [' + (debugVisuals ? 'ON' : 'off') + '] | M: map [' + (mapVisible ? 'ON' : 'off') + ']\nClick: lock pointer'}`;

        return coords;
    }

    public flashCopyFeedback(): void {
        const origColor = this.hudOverlay.style.color;
        this.hudOverlay.style.color = '#ffff00';
        setTimeout(() => {
            this.hudOverlay.style.color = origColor;
        }, 200);
    }

    public destroy(): void {
        if (this.hudOverlay.parentNode) {
            document.body.removeChild(this.hudOverlay);
        }
    }
}
