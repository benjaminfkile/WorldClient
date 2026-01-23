import { createContext, useContext, useState, useEffect, ReactNode, JSX } from 'react';

interface WorldVersionContextType {
  activeWorldVersion: string | null;
  isLoading: boolean;
  error: string | null;
}

const WorldVersionContext = createContext<WorldVersionContextType | undefined>(undefined);

export function WorldVersionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [activeWorldVersion, setActiveWorldVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchWorldVersion = async () => {
      try {
        setIsLoading(true);
        const apiUrl = process.env.REACT_APP_API_URL;
        const response = await fetch(`${apiUrl}/api/world-versions/active`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch world version: ${response.status}`);
        }

        const data = await response.json();
        const activeVersion = data.versions?.find((v: { isActive: boolean; version: string }) => v.isActive);
        
        if (!activeVersion) {
          throw new Error('No active world version found');
        }

        setActiveWorldVersion(activeVersion.version);
        setError(null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        console.error('Failed to fetch active world version:', errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorldVersion();
  }, []);

  return (
    <WorldVersionContext.Provider value={{ activeWorldVersion, isLoading, error }}>
      {children}
    </WorldVersionContext.Provider>
  );
}

export function useWorldVersion(): WorldVersionContextType {
  const context = useContext(WorldVersionContext);
  if (context === undefined) {
    throw new Error('useWorldVersion must be used within WorldVersionProvider');
  }
  return context;
}
