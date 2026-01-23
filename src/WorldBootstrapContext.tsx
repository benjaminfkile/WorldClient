import { createContext, useContext, useState, useEffect, ReactNode, JSX } from 'react';

export interface WorldContract {
  origin: { latitude: number; longitude: number };
  chunkSizeMeters: number;
  metersPerDegreeLatitude: number;
  immutable: boolean;
  description?: string;
}

export interface WorldBootstrapContextType {
  activeWorldVersion: string | null;
  worldContract: WorldContract | null;
  isLoading: boolean;
  error: string | null;
}

const WorldBootstrapContext = createContext<WorldBootstrapContextType | undefined>(undefined);

export function WorldBootstrapProvider({ children }: { children: ReactNode }): JSX.Element {
  const [activeWorldVersion, setActiveWorldVersion] = useState<string | null>(null);
  const [worldContract, setWorldContract] = useState<WorldContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBootstrap = async () => {
      try {
        setIsLoading(true);
        const apiUrl = process.env.REACT_APP_API_URL;
        if (!apiUrl) {
          throw new Error('REACT_APP_API_URL environment variable not set');
        }

        const response = await fetch(`${apiUrl}/api/world-versions/active`);

        if (!response.ok) {
          throw new Error(`Failed to fetch world bootstrap: ${response.status}`);
        }

        const data = await response.json();

        // Find active version
        const activeVersion = data.versions?.find((v: { isActive: boolean; version: string }) => v.isActive);
        if (!activeVersion) {
          throw new Error('No active world version found');
        }

        // Extract world contract
        const contract = data.worldContract;
        if (!contract) {
          throw new Error('No world contract found in bootstrap response');
        }

        // Validate contract structure and values
        validateWorldContract(contract);

        setActiveWorldVersion(activeVersion.version);
        setWorldContract(contract);
        setError(null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setActiveWorldVersion(null);
        setWorldContract(null);
        console.error('[WorldBootstrapContext] Bootstrap failed:', errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBootstrap();
  }, []);

  return (
    <WorldBootstrapContext.Provider value={{ activeWorldVersion, worldContract, isLoading, error }}>
      {children}
    </WorldBootstrapContext.Provider>
  );
}

export function useWorldBootstrap(): WorldBootstrapContextType {
  const context = useContext(WorldBootstrapContext);
  if (context === undefined) {
    throw new Error('useWorldBootstrap must be used within WorldBootstrapProvider');
  }
  return context;
}

/**
 * Validate that the world contract has all required fields with valid values
 */
function validateWorldContract(contract: unknown): asserts contract is WorldContract {
  if (!contract || typeof contract !== 'object') {
    throw new Error('World contract must be an object');
  }

  const c = contract as Record<string, unknown>;

  // Validate origin
  if (!c.origin || typeof c.origin !== 'object') {
    throw new Error('World contract must have an origin object');
  }
  const origin = c.origin as Record<string, unknown>;
  if (typeof origin.latitude !== 'number' || !Number.isFinite(origin.latitude)) {
    throw new Error('origin.latitude must be a finite number');
  }
  if (typeof origin.longitude !== 'number' || !Number.isFinite(origin.longitude)) {
    throw new Error('origin.longitude must be a finite number');
  }

  // Validate chunkSizeMeters
  if (typeof c.chunkSizeMeters !== 'number' || c.chunkSizeMeters <= 0) {
    throw new Error('chunkSizeMeters must be a positive number');
  }

  // Validate metersPerDegreeLatitude
  if (typeof c.metersPerDegreeLatitude !== 'number' || c.metersPerDegreeLatitude <= 0) {
    throw new Error('metersPerDegreeLatitude must be a positive number');
  }

  // Validate immutable flag
  if (typeof c.immutable !== 'boolean') {
    throw new Error('immutable must be a boolean');
  }
}
