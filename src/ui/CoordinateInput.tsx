import { JSX, useState } from 'react';
import type { WorldContract } from '../WorldBootstrapContext';
import { latLonToWorldMeters } from '../world/worldMath';

interface CoordinateInputProps {
  currentLat: number;
  currentLng: number;
  worldContract: WorldContract | null;
  onNavigate: (worldX: number, worldZ: number) => void;
}

export function CoordinateInput({
  currentLat,
  currentLng,
  worldContract,
  onNavigate
}: CoordinateInputProps): JSX.Element {
  const [lat, setLat] = useState<string>(currentLat.toFixed(6));
  const [lng, setLng] = useState<string>(currentLng.toFixed(6));
  const [error, setError] = useState<string>('');

  const handleNavigate = () => {
    setError('');
    
    if (!worldContract) {
      setError('World not loaded');
      return;
    }

    try {
      const latitude = Number(lat);
      const longitude = Number(lng);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setError('Invalid coordinates');
        return;
      }

      if (latitude < -90 || latitude > 90) {
        setError('Latitude must be -90 to 90');
        return;
      }

      if (longitude < -180 || longitude > 180) {
        setError('Longitude must be -180 to 180');
        return;
      }

      const worldMeters = latLonToWorldMeters(latitude, longitude, worldContract);
      onNavigate(worldMeters.worldX, worldMeters.worldZ);
      setError('');
    } catch (err) {
      setError('Navigation failed');
      console.error(err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 2000,
        backgroundColor: 'rgba(15, 15, 15, 0.9)',
        border: '1px solid #444',
        borderRadius: '4px',
        padding: '12px',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#aaa'
      }}
    >
      <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#ccc' }}>
        Navigate To
      </div>
      
      <div style={{ marginBottom: '8px', display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Latitude"
          style={{
            width: '90px',
            padding: '4px',
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            color: '#aaa',
            fontFamily: 'monospace',
            fontSize: '11px'
          }}
        />
        <input
          type="text"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Longitude"
          style={{
            width: '90px',
            padding: '4px',
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            color: '#aaa',
            fontFamily: 'monospace',
            fontSize: '11px'
          }}
        />
      </div>

      <button
        onClick={handleNavigate}
        style={{
          width: '100%',
          padding: '6px',
          backgroundColor: '#2a4a2a',
          border: '1px solid #449944',
          color: '#66dd66',
          fontFamily: 'monospace',
          fontSize: '11px',
          cursor: 'pointer',
          borderRadius: '3px',
          marginBottom: error ? '8px' : '0'
        }}
      >
        Go
      </button>

      {error && (
        <div
          style={{
            color: '#ff6666',
            fontSize: '11px',
            marginTop: '6px',
            padding: '4px',
            backgroundColor: 'rgba(100, 0, 0, 0.3)',
            borderRadius: '2px'
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginTop: '8px',
          fontSize: '10px',
          color: '#666',
          borderTop: '1px solid #333',
          paddingTop: '6px'
        }}
      >
        Current: {currentLat.toFixed(4)}, {currentLng.toFixed(4)}
      </div>
    </div>
  );
}
