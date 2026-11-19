"use client";

import { useCallback, useRef, useState } from "react";

export function useRequestLock() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const start = useCallback(() => {
    if (active.current) return false;
    active.current = true; setBusy(true);
    return true;
  }, []);
  const finish = useCallback(() => { active.current = false; setBusy(false); }, []);
  return { busy, start, finish };
}
