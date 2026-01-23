import type { WorldContract } from '../WorldBootstrapContext';

/**
 * Compute meters per degree longitude at a given latitude.
 * This accounts for the convergence of longitude lines toward the poles.
 */
export function metersPerDegreeLongitudeAtLat(
  latitudeDeg: number,
  metersPerDegreeLatitude: number
): number {
  const latRadians = latitudeDeg * (Math.PI / 180);
  return metersPerDegreeLatitude * Math.cos(latRadians);
}

/**
 * Convert world-space meters (relative to origin) to latitude/longitude.
 * 
 * @param worldX - Meters east from origin
 * @param worldZ - Meters north from origin
 * @param contract - World contract containing origin and conversion factors
 * @returns Object with latitude and longitude
 */
export function worldMetersToLatLon(
  worldX: number,
  worldZ: number,
  contract: WorldContract
): { latitude: number; longitude: number } {
  const { origin, metersPerDegreeLatitude } = contract;
  
  const latitude = origin.latitude + (worldZ / metersPerDegreeLatitude);
  
  const metersPerDegreeLon = metersPerDegreeLongitudeAtLat(origin.latitude, metersPerDegreeLatitude);
  const longitude = origin.longitude + (worldX / metersPerDegreeLon);
  
  return { latitude, longitude };
}

/**
 * Convert latitude/longitude to world-space meters (relative to origin).
 * 
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @param contract - World contract containing origin and conversion factors
 * @returns Object with worldX (east) and worldZ (north) in meters
 */
export function latLonToWorldMeters(
  latitude: number,
  longitude: number,
  contract: WorldContract
): { worldX: number; worldZ: number } {
  const { origin, metersPerDegreeLatitude } = contract;
  
  const worldZ = (latitude - origin.latitude) * metersPerDegreeLatitude;
  
  const metersPerDegreeLon = metersPerDegreeLongitudeAtLat(origin.latitude, metersPerDegreeLatitude);
  const worldX = (longitude - origin.longitude) * metersPerDegreeLon;
  
  return { worldX, worldZ };
}

/**
 * Convert world-space meters to chunk coordinates.
 * 
 * @param worldX - Meters east from origin
 * @param worldZ - Meters north from origin
 * @param contract - World contract containing chunk size
 * @returns Object with chunkX and chunkZ coordinates
 */
export function worldMetersToChunkCoords(
  worldX: number,
  worldZ: number,
  contract: WorldContract
): { chunkX: number; chunkZ: number } {
  const { chunkSizeMeters } = contract;
  
  const chunkX = Math.floor(worldX / chunkSizeMeters);
  const chunkZ = Math.floor(worldZ / chunkSizeMeters);
  
  return { chunkX, chunkZ };
}

/**
 * Convert chunk coordinates to the world-space meters position of the chunk's origin (SW corner).
 * 
 * @param chunkX - Chunk X coordinate
 * @param chunkZ - Chunk Z coordinate
 * @param contract - World contract containing chunk size
 * @returns Object with worldX and worldZ in meters (chunk's SW corner)
 */
export function chunkCoordsToWorldMetersOrigin(
  chunkX: number,
  chunkZ: number,
  contract: WorldContract
): { worldX: number; worldZ: number } {
  const { chunkSizeMeters } = contract;
  
  const worldX = chunkX * chunkSizeMeters;
  const worldZ = chunkZ * chunkSizeMeters;
  
  return { worldX, worldZ };
}

/**
 * Get the three-dimensional position for a chunk in Three.js world space.
 * 
 * @param chunkX - Chunk X coordinate
 * @param chunkZ - Chunk Z coordinate
 * @param contract - World contract containing chunk size
 * @returns Three.js position as [x, y, z] with y=0 (terrain Y set separately)
 */
export function getChunkWorldPosition(
  chunkX: number,
  chunkZ: number,
  contract: WorldContract
): [number, number, number] {
  const { worldX, worldZ } = chunkCoordsToWorldMetersOrigin(chunkX, chunkZ, contract);
  return [worldX, 0, worldZ];
}
