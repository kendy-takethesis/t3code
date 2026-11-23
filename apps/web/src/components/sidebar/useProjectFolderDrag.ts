import { useRef, useState, type DragEvent } from "react";

import {
  canPlaceProjectFolder,
  type ProjectFolderPlacement,
  resolveProjectFolderNeighbours,
} from "../Sidebar.logic";
import { sidebarFolderRowId } from "./SidebarProjectFolderHeader";

// A private type keeps the composer, file drops and other apps from accepting folder drags.
const PROJECT_FOLDER_DRAG_TYPE = "application/x-t3code-project-folder";
// Folders sit 8px apart (mt-2); the line goes in the middle of that gap.
const DROP_LINE_OFFSET_PX = 4;

interface DraggableProjectFolder {
  readonly projectKey: string;
  readonly pinned: boolean;
  readonly archived: boolean;
}

interface ProjectFolderDrop {
  readonly targetKey: string;
  readonly placement: ProjectFolderPlacement;
  /** The drop line's offset from the top of the list. */
  readonly top: number;
}

/** A folder's header and the thread rows it shows, as one vertical span. */
function measureFolderBlock(list: HTMLElement, projectKey: string) {
  const rowId = CSS.escape(sidebarFolderRowId(projectKey));
  const header = list.querySelector<HTMLElement>(`[data-sidebar-row="${rowId}"]`);
  if (header === null) return null;
  const rows = list.querySelectorAll<HTMLElement>(`[data-sidebar-parent="${rowId}"]`);
  const top = header.getBoundingClientRect().top;
  let bottom = header.getBoundingClientRect().bottom;
  for (const row of rows) bottom = Math.max(bottom, row.getBoundingClientRect().bottom);
  return { top, bottom };
}

/**
 * Native drag and drop for boring sidebar folders: a folder header drags within
 * its pin group, and a line shows where it lands. The pointer picks the nearest
 * folder; its upper half drops before it and its lower half after it.
 */
export function useProjectFolderDrag(input: {
  readonly folders: readonly DraggableProjectFolder[];
  readonly onPlace: (
    movedKey: string,
    targetKey: string,
    placement: ProjectFolderPlacement,
  ) => void;
}) {
  const { folders, onPlace } = input;
  // The dragged key is read by dragover before React renders the dragstart update.
  const movedKeyRef = useRef<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [drop, setDrop] = useState<ProjectFolderDrop | null>(null);

  const finish = () => {
    movedKeyRef.current = null;
    setDraggingKey(null);
    setDrop(null);
  };

  const resolveDrop = (list: HTMLElement, clientY: number): ProjectFolderDrop | null => {
    const movedKey = movedKeyRef.current;
    if (movedKey === null) return null;
    let nearest: { key: string; top: number; bottom: number; distance: number } | null = null;
    for (const folder of folders) {
      const block = measureFolderBlock(list, folder.projectKey);
      if (block === null) continue;
      const distance =
        clientY < block.top ? block.top - clientY : Math.max(0, clientY - block.bottom);
      if (nearest === null || distance < nearest.distance) {
        nearest = { key: folder.projectKey, ...block, distance };
      }
    }
    if (nearest === null) return null;
    const placement = clientY < (nearest.top + nearest.bottom) / 2 ? "before" : "after";
    if (!canPlaceProjectFolder(folders, movedKey, nearest.key, placement)) return null;
    const edge =
      placement === "before"
        ? nearest.top - DROP_LINE_OFFSET_PX
        : nearest.bottom + DROP_LINE_OFFSET_PX;
    return {
      targetKey: nearest.key,
      placement,
      top: edge - list.getBoundingClientRect().top,
    };
  };

  return {
    draggingKey,
    dropLineTop: drop?.top ?? null,
    /** Whether the folder has a neighbour in its pin group to move past. */
    canDrag: (projectKey: string) => {
      const { above, below } = resolveProjectFolderNeighbours(folders, projectKey);
      return above !== null || below !== null;
    },
    onFolderDragStart: (projectKey: string, event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(PROJECT_FOLDER_DRAG_TYPE, projectKey);
      event.dataTransfer.effectAllowed = "move";
      movedKeyRef.current = projectKey;
      setDraggingKey(projectKey);
    },
    onFolderDragEnd: finish,
    listDropProps: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(PROJECT_FOLDER_DRAG_TYPE)) return;
        const next = resolveDrop(event.currentTarget, event.clientY);
        if (next !== null) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
        if (
          next?.targetKey !== drop?.targetKey ||
          next?.placement !== drop?.placement ||
          next?.top !== drop?.top
        ) {
          setDrop(next);
        }
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const into = event.relatedTarget;
        if (into instanceof Node && event.currentTarget.contains(into)) return;
        setDrop(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(PROJECT_FOLDER_DRAG_TYPE)) return;
        event.preventDefault();
        const movedKey = movedKeyRef.current;
        const placed = resolveDrop(event.currentTarget, event.clientY);
        finish();
        if (movedKey !== null && placed !== null) {
          onPlace(movedKey, placed.targetKey, placed.placement);
        }
      },
    },
  };
}
