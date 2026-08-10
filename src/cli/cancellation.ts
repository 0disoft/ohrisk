/**
 * Command-scoped cancellation shared by the CLI scan and diff evidence work.
 *
 * `createCommandCancellation` observes a caller-provided signal without ever
 * aborting the caller's own controller. `createProcessCommandSignal` owns the
 * real process SIGINT/SIGTERM wiring and is only used by the CLI entrypoint,
 * so importing the library never registers process listeners.
 */

export const COMMAND_CANCELLED_EXIT_CODE = 130;

export type CommandCancellation = {
  signal: AbortSignal;
  dispose: () => void;
};

export type SignalListener = () => void;
export type SignalRegistrar = (signal: NodeJS.Signals, listener: SignalListener) => void;
export type SignalUnregistrar = (signal: NodeJS.Signals, listener: SignalListener) => void;

export function createCommandCancellation(callerSignal?: AbortSignal): CommandCancellation {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}

export function createProcessCommandSignal(input?: {
  register?: SignalRegistrar;
  unregister?: SignalUnregistrar;
}): CommandCancellation {
  const register = input?.register ?? ((signal, listener) => process.on(signal, listener));
  const unregister = input?.unregister ?? ((signal, listener) => process.off(signal, listener));
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const controller = new AbortController();
  const onSignal = () => controller.abort();

  for (const signal of signals) {
    register(signal, onSignal);
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) {
        unregister(signal, onSignal);
      }
    }
  };
}

export function isCommandCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function renderCommandCancelled(commandLabel: string): string {
  return `${commandLabel} cancelled.`;
}
