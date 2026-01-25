import * as THREE from "three";
import { TileCoordinate } from "./tileMath";

export type TileStatus = "loading" | "loaded" | "error";

interface TileRecord {
    coord: TileCoordinate;
    status: TileStatus;
    texture: THREE.Texture | null;
    listeners: Set<(texture: THREE.Texture) => void>;
}

export interface ImageryTileHandle {
    coord: TileCoordinate;
    texture: THREE.Texture | null;
    status: TileStatus;
    subscribe(onReady: (texture: THREE.Texture) => void): () => void;
}

export class ImageryTileCache {
    private loader: THREE.TextureLoader;
    private records = new Map<string, TileRecord>();
    private placeholder: THREE.DataTexture;
    private baseUrl: string;
    private stylePath?: string;

    constructor(baseUrl: string, stylePath?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.stylePath = stylePath?.replace(/^\/+|\/+$/g, "");
        this.loader = new THREE.TextureLoader();
        this.placeholder = this.createPlaceholderTexture();
    }

    public getPlaceholder(): THREE.DataTexture {
        return this.placeholder;
    }

    public getTile(coord: TileCoordinate): ImageryTileHandle {
        const key = this.getKey(coord);
        let record = this.records.get(key);

        if (!record) {
            record = {
                coord,
                status: "loading",
                texture: null,
                listeners: new Set<(texture: THREE.Texture) => void>(),
            };
            this.records.set(key, record);
            this.loadTile(record);
        }

        const handle: ImageryTileHandle = {
            coord,
            texture: record.texture,
            status: record.status,
            subscribe: (onReady: (texture: THREE.Texture) => void): (() => void) => {
                if (record?.status === "loaded" && record.texture) {
                    onReady(record.texture);
                    return () => { /* noop */ };
                }
                record?.listeners.add(onReady);
                return () => {
                    record?.listeners.delete(onReady);
                };
            }
        };

        return handle;
    }

    private loadTile(record: TileRecord): void {
        const url = this.buildTileUrl(record.coord);
        this.loader.load(
            url,
            (texture: THREE.Texture) => {
                this.configureTexture(texture);
                record.status = "loaded";
                record.texture = texture;
                record.listeners.forEach(cb => cb(texture));
                record.listeners.clear();
            },
            undefined,
            () => {
                record.status = "error";
                record.texture = this.placeholder;
                record.listeners.clear();
            }
        );
    }

    private configureTexture(texture: THREE.Texture): void {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
    }

    private buildTileUrl(coord: TileCoordinate): string {
        const mapId = this.stylePath || process.env.REACT_APP_MAPTILER_MAP_ID || "";
        return `${this.baseUrl}/world/imagery/maptiler/${mapId}/${coord.z}/${coord.x}/${coord.y}`;
    }

    private getKey(coord: TileCoordinate): string {
        return `${coord.z}/${coord.x}/${coord.y}`;
    }

    private createPlaceholderTexture(): THREE.DataTexture {
        const value = 0x80;
        const data = new Uint8Array([value, value, value, 255]);
        const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }
}
