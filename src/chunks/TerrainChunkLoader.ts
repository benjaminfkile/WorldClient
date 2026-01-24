import { WorldChunk } from "../types";

export class TerrainChunkLoader {
    // Decode binary terrain data (.NET format)
    public static decodeBinaryTerrain(buffer: ArrayBuffer, chunkX: number, chunkZ: number): WorldChunk {
        const view = new DataView(buffer);
        let offset = 0;

        // Read version (1 byte) - kept for format validation
        view.getUint8(offset);
        offset += 1;

        // Read resolution (2 bytes, ushort, little-endian)
        const resolution = view.getUint16(offset, true);
        offset += 2;

        // Read minElevation (8 bytes, double, little-endian) - kept for validation
        view.getFloat64(offset, true);
        offset += 8;

        // Read maxElevation (8 bytes, double, little-endian) - kept for validation
        view.getFloat64(offset, true);
        offset += 8;

        // Calculate expected height count: (resolution + 1) * (resolution + 1)
        const gridSize = resolution + 1;
        const heightCount = gridSize * gridSize;
        const expectedBufferSize = 19 + heightCount * 4; // 1 + 2 + 8 + 8 + heights

        // Validate buffer size
        if (buffer.byteLength !== expectedBufferSize) {
            throw new Error(
                `Buffer size mismatch for chunk ${chunkX},${chunkZ}: ` +
                `got ${buffer.byteLength} bytes, expected ${expectedBufferSize} bytes ` +
                `(resolution=${resolution}, gridSize=${gridSize}, heightCount=${heightCount})`
            );
        }

        // Read heights array ((resolution + 1) * (resolution + 1) * 4 bytes each, float32, little-endian)
        const heights = new Float32Array(heightCount);
        for (let i = 0; i < heightCount; i++) {
            const height = view.getFloat32(offset, true);
            
            // Validate height value
            if (!isFinite(height)) {
                console.error(
                    `Invalid height value at index ${i} in chunk ${chunkX},${chunkZ}: ${height} ` +
                    `(NaN or Infinity detected)`
                );
            }
            
            heights[i] = height;
            offset += 4;
        }

        return {
            chunkX,
            chunkZ,
            terrain: {
                resolution,
                heights: Array.from(heights)
            },
            roads: [],
            rivers: []
        };
    }

    // Fetch chunk (single attempt, no polling)
    // Returns: WorldChunk on 200, null on 202 (retry later), { dem_missing: true } on 204 (DEM not available)
    public static async fetchChunkOnce(
        chunkX: number,
        chunkZ: number,
        resolution: number,
        abortSignal: AbortSignal,
        worldVersion: string
    ): Promise<WorldChunk | null | { dem_missing: true }> {
        // Clamp to supported resolutions to keep URLs deterministic and cache-friendly
        const allowedResolutions = [16, 32, 64, 128];
        const clampedResolution = allowedResolutions.includes(resolution)
            ? resolution
            : Math.min(Math.max(resolution, 16), 64);

        const url = `${process.env.REACT_APP_API_URL}/world/${worldVersion}/terrain/${clampedResolution}/${chunkX}/${chunkZ}`;

        if (process.env.NODE_ENV === 'development') {
            //console.log(`[Chunk] Fetching: ${key} (res=${clampedResolution})`);
        }

        const res = await fetch(url, { signal: abortSignal });

        if (res.status === 200) {
            // Chunk ready - read binary data
            const buffer = await res.arrayBuffer();
            if (process.env.NODE_ENV === 'development') {
                //console.log(`[Chunk] Ready (200): ${key} (res=${clampedResolution})`);
            }
            return TerrainChunkLoader.decodeBinaryTerrain(buffer, chunkX, chunkZ);
        } else if (res.status === 202) {
            // Chunk still generating - schedule retry
            if (process.env.NODE_ENV === 'development') {
                //console.log(`[Chunk] Still generating (202): ${key} (res=${clampedResolution})`);
            }
            return null;
        } else if (res.status === 204) {
            // DEM is missing for this chunk - not an error, just unavailable
            if (process.env.NODE_ENV === 'development') {
                //console.log(`[Chunk] DEM missing (204): ${chunkX},${chunkZ}`);
            }
            return { dem_missing: true };
        } else {
            throw new Error(`Unexpected status: ${res.status}`);
        }
    }
}
