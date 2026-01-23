import { useEffect, useRef } from 'react';

interface MapWindowProps {
    latitude: number;
    longitude: number;
    onMapLoad?: () => void;
}

export default function MapWindow({ latitude, longitude, onMapLoad }: MapWindowProps): null {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const scriptLoadedRef = useRef(false);

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
            if (scriptLoadedRef.current && !mapRef.current && mapContainerRef.current && !(window as any).google?.maps) {
                console.warn('[MapWindow] Google Maps API not available');
                return;
            }

            if (!scriptLoadedRef.current) {
                const script = document.createElement('script');
                const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
                
                if (!apiKey) {
                    console.error('[MapWindow] Google Maps API key not found in .env');
                    return;
                }

                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
                script.async = true;
                script.defer = true;
                script.onload = () => {
                    scriptLoadedRef.current = true;
                    initMap();
                };
                script.onerror = () => {
                    console.error('[MapWindow] Failed to load Google Maps script');
                };
                document.head.appendChild(script);
            } else if (!mapRef.current) {
                initMap();
            }
        };

        function initMap() {
            if (!mapContainerRef.current) {
                console.error('[MapWindow] Map container not found');
                return;
            }

            if (!mapRef.current) {
                try {
                    const initialLocation = { lat: latitude, lng: longitude };

                    // Create map
                    mapRef.current = new (window as any).google.maps.Map(mapContainerRef.current, {
                        zoom: 16,
                        center: initialLocation,
                        mapTypeId: (window as any).google.maps.MapTypeId.SATELLITE,
                        disableDefaultUI: true,
                        zoomControl: true,
                        zoomControlOptions: {
                            position: (window as any).google.maps.ControlPosition.BOTTOM_RIGHT,
                        },
                    });

                    // Create marker
                    markerRef.current = new (window as any).google.maps.Marker({
                        position: initialLocation,
                        map: mapRef.current,
                        title: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
                    });

                    onMapLoad?.();
                    //console.log('[MapWindow] Map initialized successfully');
                } catch (error) {
                    console.error('[MapWindow] Error initializing map:', error);
                }
            }
        }

        loadMap();

        return () => {
            // Don't remove the container on unmount - keep the map visible
        };
    }, [onMapLoad, latitude, longitude]);

    // Update marker position when coordinates change
    useEffect(() => {
        if (markerRef.current && mapRef.current) {
            const newLocation = { lat: latitude, lng: longitude };
            markerRef.current.setPosition(newLocation);
            markerRef.current.setTitle(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
            mapRef.current.setCenter(newLocation);
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
