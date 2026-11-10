/**
 * Idle scheduling and active AI streaming tracking so heavy hashing / snapshot GC
 * never executes while an AI response is actively streaming.
 */

const activeStreamingCounts = new Map<string, number>();

export function markStreamingActive(projectId: string, active: boolean): void {
  if (!projectId) return;
  const current = activeStreamingCounts.get(projectId) ?? 0;
  if (active) {
    activeStreamingCounts.set(projectId, current + 1);
  } else if (current <= 1) {
    activeStreamingCounts.delete(projectId);
  } else {
    activeStreamingCounts.set(projectId, current - 1);
  }
}

export function clearStreamingActive(projectId: string): void {
  activeStreamingCounts.delete(projectId);
}

export function isStreamingActive(projectId: string): boolean {
  return (activeStreamingCounts.get(projectId) ?? 0) > 0;
}

export function isAnyStreamingActive(): boolean {
  return activeStreamingCounts.size > 0;
}

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

type RequestIdleCallbackFn = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number }
) => number;

type CancelIdleCallbackFn = (handle: number) => void;

/**
 * Schedules background work off the active main thread render loop.
 * Uses requestIdleCallback where available, falling back to setTimeout.
 */
export function scheduleIdleWork(
  work: () => void | Promise<void>,
  timeoutMs = 1500
): () => void {
  let cancelled = false;
  let idleHandle: number | null = null;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;

  const runWork = () => {
    if (cancelled) return;
    try {
      const result = work();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err) => {
          console.warn('[DESYRA Idle] Background task failed:', err);
        });
      }
    } catch (err) {
      console.warn('[DESYRA Idle] Background task threw:', err);
    }
  };

  if (typeof window !== 'undefined') {
    const win = window as unknown as {
      requestIdleCallback?: RequestIdleCallbackFn;
      cancelIdleCallback?: CancelIdleCallbackFn;
    };
    if (typeof win.requestIdleCallback === 'function') {
      idleHandle = win.requestIdleCallback(() => runWork(), { timeout: timeoutMs });
      return () => {
        cancelled = true;
        if (idleHandle !== null && typeof win.cancelIdleCallback === 'function') {
          win.cancelIdleCallback(idleHandle);
        }
      };
    }
  }

  timerHandle = setTimeout(runWork, 150);
  return () => {
    cancelled = true;
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
    }
  };
}
