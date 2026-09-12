import { createContext, useContext, type ReactNode } from 'react';

interface LocationPreviewContextValue {
  showLocationPreview: boolean;
  setShowLocationPreview: (enabled: boolean) => void;
}

const noop = () => {};

const LocationPreviewContext = createContext<LocationPreviewContextValue>({
  showLocationPreview: false,
  setShowLocationPreview: noop,
});

export function LocationPreviewProvider({
  showLocationPreview,
  setShowLocationPreview,
  children,
}: LocationPreviewContextValue & { children: ReactNode }) {
  return (
    <LocationPreviewContext.Provider value={{ showLocationPreview, setShowLocationPreview }}>
      {children}
    </LocationPreviewContext.Provider>
  );
}

export function useLocationPreview() {
  return useContext(LocationPreviewContext);
}
