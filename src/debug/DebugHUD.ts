import { Vector3 } from "three";

const CHUNK_SIZE = 100;
const ORIGIN_LATITUDE = 46.8721;
const ORIGIN_LONGITUDE = -113.994;
const METERS_PER_DEGREE_LATITUDE = 111320;

export class DebugHUD {
    private hudOverlay: HTMLDivElement;

    constructor() {
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
        this.hudOverlay.style.zIndex = '1000';
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
        const camChunkX = Math.floor(cameraPosition.x / CHUNK_SIZE);
        const camChunkZ = Math.floor(cameraPosition.z / CHUNK_SIZE);
        
        const originLatRad = ORIGIN_LATITUDE * (Math.PI / 180);
        const metersPerDegreeLon = METERS_PER_DEGREE_LATITUDE * Math.cos(originLatRad);
        
        const latitude = ORIGIN_LATITUDE + (cameraPosition.z / METERS_PER_DEGREE_LATITUDE);
        const longitude = ORIGIN_LONGITUDE + (cameraPosition.x / metersPerDegreeLon);
        
        this.hudOverlay.textContent = 
            `LAT: ${latitude.toFixed(6)}\n` +
            `LON: ${longitude.toFixed(6)}\n` +
            `Chunk: [${camChunkX}, ${camChunkZ}]\n` +
            `World: [${cameraPosition.x.toFixed(1)}, ${cameraPosition.z.toFixed(1)}]\n` +
            `Queue: ${queueSize} | Loading: ${loadingCount}/${maxConcurrentLoads}\n` +
            `\n` +
            `WASD/Arrow: move | Space: up | Ctrl: down\n` +
            `${pointerLocked ? 'ESC: unlock | C: copy | G: debug | M: map' : 'C: copy | G: debug [' + (debugVisuals ? 'ON' : 'off') + '] | M: map [' + (mapVisible ? 'ON' : 'off') + ']\nClick: lock pointer'}`;

        return { latitude, longitude };
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
