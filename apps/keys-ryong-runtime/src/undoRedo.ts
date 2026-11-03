import { createContext, useMemo, useRef, useState } from "react";

export type UndoCallback = () => Promise<void>;

export type DoCallback = () => Promise<UndoCallback>;

export function useUndoRedo(): [
  (dc: DoCallback) => Promise<void>,
  () => Promise<void>,
  () => Promise<void>,
  boolean,
  boolean,
  () => void
] {
  const [locked, setLocked] = useState<boolean>(false);
  const [undoStack, setUndoStack] = useState<Array<[DoCallback, UndoCallback]>>(
    []
  );
  const [redoStack, setRedoStack] = useState<Array<DoCallback>>([]);

  const canUndo = useMemo(
    () => !locked && undoStack.length > 0,
    [locked, undoStack]
  );
  const canRedo = useMemo(
    () => !locked && redoStack.length > 0,
    [locked, redoStack]
  );

  // Ryong: edits run one after another (fast clicks no longer overwrite each other's undo entries),
  // a failed edit adds no undo entry, and the lock is always released.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const doIt = (doCb: DoCallback, preserveRedo?: boolean) => {
    const run = chain.current.then(async () => {
      setLocked(true);
      try {
        const undo = await doCb();
        setUndoStack((s) => [[doCb, undo], ...s]);
        if (!preserveRedo) {
          setRedoStack([]);
        }
      } finally {
        setLocked(false);
      }
    });
    chain.current = run.catch(() => {});
    return run;
  };

  const undo = async () => {
    if (locked) {
      throw new Error("undo invoked when existing operation in progress");
    }

    if (undoStack.length === 0) {
      throw new Error("undo invoked with no operations to undo");
    }

    setLocked(true);
    let [doCb, undoCb] = undoStack[0];
    setUndoStack((s) => s.slice(1));
    setRedoStack((s) => [doCb, ...s]);

    try {
      await undoCb();
    } finally {
      setLocked(false);
    }
  };

  const redo = async () => {
    if (locked) {
      throw new Error("redo invoked when existing operation in progress");
    }

    if (redoStack.length === 0) {
      throw new Error("redo invoked with no operations to redo");
    }

    let doCb = redoStack[0];

    setRedoStack((s) => s.slice(1));

    return await doIt(doCb, true);
  };

  const reset = () => {
    setRedoStack([]);
    setUndoStack([]);
  };

  return [doIt, undo, redo, canUndo, canRedo, reset];
}

export const UndoRedoContext = createContext<
  ((dc: DoCallback) => Promise<void>) | null
>(null);
