'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the signed-in person can change things in this business (M13: viewers can't). Only hides
 * what they can't use; the server refuses them anyway (ADR-062).
 */
const CanChange = createContext(true);

export function CanChangeProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <CanChange.Provider value={value}>{children}</CanChange.Provider>;
}

export function useCanChange(): boolean {
  return useContext(CanChange);
}
