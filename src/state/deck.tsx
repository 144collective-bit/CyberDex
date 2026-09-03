import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { activeDeck } from '../core/deck/deckReducer';
import type { DeckAction } from '../core/deck/deckReducer';
import type { PortDataType } from '../core/modules/ports';
import type { Connection, Deck, ModuleInstance } from '../core/modules/types';
import { useStoreSelector, shallowArrayEqual } from '../core/useStore';
import { useSystem } from './system';
import { clampZoom } from '../components/desk/zoom';

export function useWorkspaceState() {
  const system = useSystem();
  return useStoreSelector(system.workspace, (s) => s);
}

export function useDeckList(): { id: string; name: string }[] {
  const system = useSystem();
  return useStoreSelector(
    system.workspace,
    (s) => s.decks.map((d) => ({ id: d.id, name: d.name })),
    (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i]?.id && item.name === b[i]?.name),
  );
}

export function useActiveDeck(): Deck {
  const system = useSystem();
  const deck = useStoreSelector(system.workspace, (s) => activeDeck(s));
  if (!deck) throw new Error('No active deck');
  return deck;
}

/** Module ids only — the desk re-renders on add/remove, not on every drag. */
export function useDeckModuleIds(): string[] {
  const system = useSystem();
  return useStoreSelector(
    system.workspace,
    (s) => activeDeck(s)?.modules.map((m) => m.id) ?? [],
    shallowArrayEqual,
  );
}

export function useDeckModule(moduleId: string): ModuleInstance | undefined {
  const system = useSystem();
  return useStoreSelector(system.workspace, (s) => activeDeck(s)?.modules.find((m) => m.id === moduleId));
}

export function useDeckConnections(): Connection[] {
  const system = useSystem();
  return useStoreSelector(system.workspace, (s) => activeDeck(s)?.connections ?? [], shallowArrayEqual);
}

export function useDeckDispatch(): (action: DeckAction) => void {
  const system = useSystem();
  return useCallback((action: DeckAction) => system.workspace.dispatch(action), [system]);
}

/** Dispatch bound to the active deck id, which is what module UI always wants. */
export function useDeckActions() {
  const system = useSystem();
  const deckId = useStoreSelector(system.workspace, (s) => s.activeDeckId);
  return useMemo(
    () => ({
      deckId,
      dispatch: (action: DeckAction) => system.workspace.dispatch(action),
      addModule: (moduleType: string, overrides?: Partial<ModuleInstance>) =>
        system.workspace.dispatch({ type: 'MODULE/ADD', deckId, moduleType, overrides }),
      removeModule: (moduleId: string) =>
        system.workspace.dispatch({ type: 'MODULE/REMOVE', deckId, moduleId }),
      moveModule: (moduleId: string, position: { x: number; y: number }, exact?: boolean) =>
        system.workspace.dispatch({ type: 'MODULE/MOVE', deckId, moduleId, position, exact }),
      swapModules: (moduleId: string, targetId: string) =>
        system.workspace.dispatch({ type: 'MODULE/SWAP', deckId, moduleId, targetId }),
      resizeModule: (moduleId: string, size: { width: number; height: number }) =>
        system.workspace.dispatch({ type: 'MODULE/RESIZE', deckId, moduleId, size }),
      patchModule: (moduleId: string, patch: Partial<ModuleInstance>) =>
        system.workspace.dispatch({ type: 'MODULE/PATCH', deckId, moduleId, patch }),
      configureModule: (moduleId: string, patch: Record<string, unknown>) =>
        system.workspace.dispatch({ type: 'MODULE/CONFIG', deckId, moduleId, patch }),
      duplicateModule: (moduleId: string) =>
        system.workspace.dispatch({ type: 'MODULE/DUPLICATE', deckId, moduleId }),
      raiseModule: (moduleId: string) => system.workspace.dispatch({ type: 'MODULE/RAISE', deckId, moduleId }),
      connect: (source: { moduleId: string; portId: string }, target: { moduleId: string; portId: string }) =>
        system.workspace.dispatch({ type: 'LINK/CONNECT', deckId, source, target }),
      disconnect: (connectionId: string) =>
        system.workspace.dispatch({ type: 'LINK/DISCONNECT', deckId, connectionId }),
      updateSettings: (patch: Partial<Deck['settings']>) =>
        system.workspace.dispatch({ type: 'DECK/SETTINGS', deckId, patch }),
      renameDeck: (name: string) => system.workspace.dispatch({ type: 'DECK/RENAME', deckId, name }),
      save: () => system.workspace.flush(),
    }),
    [system, deckId],
  );
}

/* ---------------------------------------------------------------- desk UI */

export interface DragPreview {
  moduleId: string;
  /** Where the module would land, after snapping. */
  rect: { x: number; y: number; width: number; height: number };
  guides: { orientation: 'v' | 'h'; position: number; from: number; to: number }[];
  swapTargetId: string | null;
}

export interface LinkDraft {
  moduleId: string;
  portId: string;
  side: 'in' | 'out';
  /** Carried so ports can show compatibility without a store lookup. */
  type: PortDataType;
  x: number;
  y: number;
}

interface DeskUI {
  selectedModuleId: string | null;
  selectedLinkId: string | null;
  fullscreenModuleId: string | null;
  draft: LinkDraft | null;
  dragPreview: DragPreview | null;
  setDragPreview(preview: DragPreview | null): void;
  /** Enlarges and labels every port, so links are findable. */
  linkMode: boolean;
  toggleLinkMode(): void;
  /** Canvas scale. Drag maths divides client deltas by it. */
  zoom: number;
  setZoom(zoom: number): void;
  select(moduleId: string | null): void;
  selectLink(linkId: string | null): void;
  setFullscreen(moduleId: string | null): void;
  beginLink(draft: LinkDraft): void;
  moveLink(x: number, y: number): void;
  endLink(): void;
}

const DeskUIContext = createContext<DeskUI | null>(null);

export function DeskUIProvider({ children }: { children: ReactNode }) {
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [fullscreenModuleId, setFullscreenModuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [zoom, setZoom] = useState(1);

  const value = useMemo<DeskUI>(
    () => ({
      selectedModuleId,
      selectedLinkId,
      fullscreenModuleId,
      draft,
      dragPreview,
      setDragPreview,
      linkMode,
      toggleLinkMode: () => setLinkMode((prev) => !prev),
      zoom,
      setZoom: (next: number) => setZoom(clampZoom(next)),
      select: (moduleId) => {
        setSelectedModuleId(moduleId);
        setSelectedLinkId(null);
      },
      selectLink: (linkId) => {
        setSelectedLinkId(linkId);
        setSelectedModuleId(null);
      },
      setFullscreen: setFullscreenModuleId,
      beginLink: (next) => setDraft(next),
      moveLink: (x, y) => setDraft((prev) => (prev ? { ...prev, x, y } : prev)),
      endLink: () => setDraft(null),
    }),
    [selectedModuleId, selectedLinkId, fullscreenModuleId, draft, dragPreview, linkMode, zoom],
  );

  return <DeskUIContext.Provider value={value}>{children}</DeskUIContext.Provider>;
}

export function useDeskUI(): DeskUI {
  const ctx = useContext(DeskUIContext);
  if (!ctx) throw new Error('useDeskUI must be used inside <DeskUIProvider>');
  return ctx;
}
