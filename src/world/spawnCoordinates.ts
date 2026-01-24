/**
 * Helper to read and validate spawn coordinates from environment variables.
 * These represent the initial camera spawn location in lat/lon format.
 */

export interface SpawnCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Read spawn coordinates from environment variables.
 * 
 * Expected env vars:
 *   REACT_APP_ORIGIN_LAT - spawn latitude (temporary naming for backward compat)
 *   REACT_APP_ORIGIN_LNG - spawn longitude (temporary naming for backward compat)
 * 
 * @throws Error if coordinates are missing or invalid
 * @returns Object with validated latitude and longitude
 */
export function readSpawnCoordinates(): SpawnCoordinates {
  const latStr = process.env.REACT_APP_ORIGIN_LAT;
  const lngStr = process.env.REACT_APP_ORIGIN_LNG;

  if (!latStr || !lngStr) {
    throw new Error(
      'Spawn coordinates not configured. Please set REACT_APP_ORIGIN_LAT and REACT_APP_ORIGIN_LNG.'
    );
  }

  const latitude = Number(latStr);
  const longitude = Number(lngStr);

  if (!Number.isFinite(latitude)) {
    throw new Error(`REACT_APP_ORIGIN_LAT must be a finite number, got: ${latStr}`);
  }

  if (!Number.isFinite(longitude)) {
    throw new Error(`REACT_APP_ORIGIN_LNG must be a finite number, got: ${lngStr}`);
  }

  // Validate latitude range [-90, 90]
  if (latitude < -90 || latitude > 90) {
    throw new Error(
      `REACT_APP_ORIGIN_LAT must be between -90 and 90, got: ${latitude}`
    );
  }

  // Validate longitude range [-180, 180]
  if (longitude < -180 || longitude > 180) {
    throw new Error(
      `REACT_APP_ORIGIN_LNG must be between -180 and 180, got: ${longitude}`
    );
  }

  return { latitude, longitude };
}
