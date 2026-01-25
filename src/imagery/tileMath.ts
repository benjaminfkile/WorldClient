import type { WorldContract } from "../WorldBootstrapContext";
import { worldMetersToLatLon } from "../world/worldMath";

export interface TileCoordinate {
    x: number;
    y: number;
    z: number;
}

const WEB_MERCATOR_LAT_LIMIT = 85.0511287798066;

export function latLonToTileXY(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
    const clampedLat = Math.max(Math.min(latitude, WEB_MERCATOR_LAT_LIMIT), -WEB_MERCATOR_LAT_LIMIT);
    const latRad = (clampedLat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const x = ((longitude + 180) / 360) * n;
    const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * 0.5 * n;
    return { x, y };
}

export function latLonToTileCoordinate(latitude: number, longitude: number, zoom: number): TileCoordinate {
    const { x, y } = latLonToTileXY(latitude, longitude, zoom);
    return { x: Math.floor(x), y: Math.floor(y), z: zoom };
}

export function worldMetersToTileCoordinate(
    worldX: number,
    worldZ: number,
    contract: WorldContract,
    zoom: number
): TileCoordinate {
    const { latitude, longitude } = worldMetersToLatLon(worldX, worldZ, contract);
    return latLonToTileCoordinate(latitude, longitude, zoom);
}

export function getChunkTileCoverage(
    chunkX: number,
    chunkZ: number,
    contract: WorldContract,
    zoom: number
): TileCoordinate[] {
    const chunkSize = contract.chunkSizeMeters;
    const corners: Array<{ worldX: number; worldZ: number }> = [
        { worldX: chunkX * chunkSize, worldZ: chunkZ * chunkSize },
        { worldX: (chunkX + 1) * chunkSize, worldZ: chunkZ * chunkSize },
        { worldX: chunkX * chunkSize, worldZ: (chunkZ + 1) * chunkSize },
        { worldX: (chunkX + 1) * chunkSize, worldZ: (chunkZ + 1) * chunkSize },
    ];

    const tileMap = new Map<string, TileCoordinate>();

    for (const corner of corners) {
        const tile = worldMetersToTileCoordinate(corner.worldX, corner.worldZ, contract, zoom);
        const key = `${tile.x},${tile.y},${tile.z}`;
        if (!tileMap.has(key)) {
            tileMap.set(key, tile);
        }
    }

    return Array.from(tileMap.values()).sort((a, b) => (a.y - b.y) || (a.x - b.x));
}
