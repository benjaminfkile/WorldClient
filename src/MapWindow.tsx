import { useEffect, useRef } from 'react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';

interface MapWindowProps {
    latitude: number;
    longitude: number;
    onMapLoad?: () => void;
}

export default function MapWindow({ latitude, longitude, onMapLoad }: MapWindowProps): null {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maptilersdk.Map | null>(null);
    const markerRef = useRef<maptilersdk.Marker | null>(null);

    useEffect(() => {
        // Try to find existing map container first
        let container = document.getElementById('map-container-world-map') as HTMLDivElement | null;
        
        if (!container) {
            // Create container element if it doesn't exist
            container = document.createElement('div');
            container.id = 'map-container-world-map';
            
            // Calculate position: upper right
            const mapWidth = 400;
            const mapHeight = 400;
            const padding = 0;
            const leftPos = window.innerWidth - mapWidth - padding;
            
            container.style.position = 'fixed';
            container.style.top = padding + 'px';
            container.style.left = (leftPos - 20) + 'px';
            container.style.width = mapWidth + 'px';
            container.style.height = mapHeight + 'px';
            container.style.borderRadius = '8px';
            container.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
            container.style.border = '3px solid lime';
            container.style.zIndex = '999999';
            container.style.backgroundColor = '#222';
            container.style.pointerEvents = 'auto';
            container.style.margin = '0';
            container.style.padding = '0';
            
            document.body.appendChild(container);
            //console.log('[MapWindow] Container created at left:', leftPos, 'top: 10');
        }

        mapContainerRef.current = container;

        const loadMap = () => {
            const apiKey = process.env.REACT_APP_MAPTILER_API_KEY;
            const mapId = process.env.REACT_APP_MAPTILER_MAP_ID;

            if (!apiKey) {
                console.error('[MapWindow] Missing REACT_APP_MAPTILER_API_KEY');
                return;
            }

            if (!mapId) {
                console.error('[MapWindow] Missing REACT_APP_MAPTILER_MAP_ID');
                return;
            }

            if (mapRef.current || !mapContainerRef.current) {
                return;
            }

            maptilersdk.config.apiKey = apiKey;

            const styleUrl = `https://api.maptiler.com/maps/${mapId}/style.json`;

            try {
                mapRef.current = new maptilersdk.Map({
                    container: mapContainerRef.current,
                    style: styleUrl,
                    center: [longitude, latitude],
                    zoom: 16,
                    attributionControl: false,
                    hash: false,
                    dragRotate: true,
                    touchZoomRotate: true,
                    scrollZoom: true,
                    boxZoom: false,
                    doubleClickZoom: true,
                });

                markerRef.current = new maptilersdk.Marker({ color: '#39ff14' })
                    .setLngLat([longitude, latitude])
                    .addTo(mapRef.current)
                    .setPopup(undefined);
            } catch (err) {
                console.error('[MapWindow] Failed to initialize MapTiler map', err);
            }
        };

        loadMap();

        return () => {
            // Don't remove the container on unmount - keep the map visible
        };
    }, [onMapLoad, latitude, longitude]);

    // Update marker position when coordinates change
    useEffect(() => {
        if (markerRef.current && mapRef.current) {
            const lngLat: [number, number] = [longitude, latitude];
            markerRef.current.setLngLat(lngLat);
            markerRef.current.getElement().setAttribute('title', `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
            mapRef.current.setCenter(lngLat);
        }
    }, [latitude, longitude]);

    // Control visibility of the map container
    useEffect(() => {
        if (mapContainerRef.current) {
            mapContainerRef.current.style.display = 'block';
        }
    }, []);

    return null;
}
