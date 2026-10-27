'use client';

import type { Teammate } from '@bizr/core/team';
import { createContext, useContext, type ReactNode } from 'react';

/** Who is looking, and who insights can be handed to (M13). */
interface Team {
  me: string;
  people: Teammate[];
}

const TeamContext = createContext<Team>({ me: '', people: [] });

export function TeamProvider({ value, children }: { value: Team; children: ReactNode }) {
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): Team {
  return useContext(TeamContext);
}
