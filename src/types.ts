export interface TerrainData {
  resolution: number;
  heights: number[];
}

export interface WorldChunk {
  chunkX: number;
  chunkZ: number;
  terrain: TerrainData;
  roads: any[];
  rivers: any[];
}
