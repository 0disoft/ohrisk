import type { OhriskError } from "../shared/errors";

/**
 * Operation-scoped cancellation shared by the parallel evidence workers of one
 * batch. A caller signal is observed through a listener so the caller's own
 * controller is never aborted by this batch.
 */
export class BatchCancellation {
  readonly controller = new AbortController();
  private readonly callerSignal: AbortSignal | undefined;
  private readonly onCallerAbort: () => void;

  constructor(callerSignal?: AbortSignal) {
    this.callerSignal = callerSignal;
    this.onCallerAbort = () => this.controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        this.controller.abort();
      } else {
        callerSignal.addEventListener("abort", this.onCallerAbort, { once: true });
      }
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  dispose(): void {
    if (this.callerSignal) {
      this.callerSignal.removeEventListener("abort", this.onCallerAbort);
    }
  }
}

export function isCollectionAbortedError(error: OhriskError): boolean {
  return error.details?.reason === "aborted";
}

export function isAbortErrorLike(cause: unknown): boolean {
  if (cause instanceof Error) {
    return cause.name === "AbortError";
  }
  if (typeof cause === "object" && cause !== null) {
    return (cause as { name?: unknown }).name === "AbortError";
  }
  return false;
}

export function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || !signal) {
      setTimeout(resolve, Math.max(0, ms));
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
