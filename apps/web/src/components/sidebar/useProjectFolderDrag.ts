import { useRef, useState, type DragEvent } from "react";

import {
  canPlaceProjectFolder,
  type OrderedProjectFolder,
  type ProjectFolderPlacement,
} from "../Sidebar.logic";
import { sidebarFolderRowId } from "./SidebarProjectFolderHeader";

// A private type keeps the composer, file drops and other apps from accepting folder drags.
// The drop side checks the dragged key instead, since some drag paths drop custom types.
const PROJECT_FOLDER_DRAG_TYPE = "application/x-t3code-project-folder";
// Folders sit 8px apart (mt-2); the line goes in the middle of that gap.
const DROP_LINE_OFFSET_PX = 4;

interface ProjectFolderDrop {
  readonly targetKey: string;
  readonly placement: ProjectFolderPlacement;
  /** The drop line's offset from the top of the list. */
  readonly top: number;
}

/** Each shown folder's header and thread rows as one vertical span, keyed by folder row id. */
function measureFolderBlocks(list: HTMLElement) {
  const blocks = new Map<string, { top: number; bottom: number }>();
  for (const row of list.querySelectorAll<HTMLElement>(
    '[data-sidebar-row^="folder:"], [data-sidebar-parent^="folder:"]',
  )) {
    const bounds = row.getBoundingClientRect();
    const headerId = row.dataset.sidebarRow;
    if (headerId?.startsWith("folder:")) {
      blocks.set(headerId, { top: bounds.top, bottom: bounds.bottom });
      continue;
    }
    // A folder's thread rows follow its header in the list.
    const block = blocks.get(row.dataset.sidebarParent ?? "");
    if (block) block.bottom = Math.max(block.bottom, bounds.bottom);
  }
  return blocks;
}

/**
 * Native drag and drop for boring sidebar folders: a folder header drags within
 * its pin group, and a line shows where it lands. The pointer picks the nearest
 * folder; its upper half drops before it and its lower half after it.
 */
export function useProjectFolderDrag(input: {
  readonly folders: readonly OrderedProjectFolder[];
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
    const blocks = measureFolderBlocks(list);
    let nearest: { key: string; top: number; bottom: number; distance: number } | null = null;
    for (const folder of folders) {
      const block = blocks.get(sidebarFolderRowId(folder.projectKey));
      if (block === undefined) continue;
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
    /** Archived folders stay below the rest. A folder alone in its group still drags, so the labels show why it cannot move. */
    canDrag: (projectKey: string) =>
      folders.some((folder) => folder.projectKey === projectKey && !folder.archived),
    onFolderDragStart: (projectKey: string, event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(PROJECT_FOLDER_DRAG_TYPE, projectKey);
      event.dataTransfer.effectAllowed = "move";
      movedKeyRef.current = projectKey;
      // Chromium cancels a native drag whose source moves while dragstart runs, and the
      // group labels shift the list, so they appear once the drag has begun.
      requestAnimationFrame(() => {
        if (movedKeyRef.current === projectKey) setDraggingKey(projectKey);
      });
    },
    onFolderDragEnd: finish,
    listDropProps: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (movedKeyRef.current === null) return;
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
        const movedKey = movedKeyRef.current;
        if (movedKey === null) return;
        event.preventDefault();
        const placed = resolveDrop(event.currentTarget, event.clientY);
        finish();
        if (placed !== null) onPlace(movedKey, placed.targetKey, placed.placement);
      },
    },
  };
}
