export type ToastTone = "success" | "info" | "error";

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastListener = (input: ToastInput) => void;

const listeners = new Set<ToastListener>();
const pending: ToastInput[] = [];

function emit(input: ToastInput) {
  const message = input.message.trim();
  if (!message) return;
  const normalized = { ...input, message };

  if (listeners.size === 0) {
    pending.push(normalized);
    if (pending.length > 2) pending.shift();
    return;
  }

  for (const listener of listeners) listener(normalized);
}

export const toast = {
  show: emit,
  success(message: string, durationMs?: number) {
    emit({ message, tone: "success", durationMs });
  },
  info(message: string, durationMs?: number) {
    emit({ message, tone: "info", durationMs });
  },
  error(message: string, durationMs?: number) {
    emit({ message, tone: "error", durationMs });
  },
  subscribe(listener: ToastListener) {
    listeners.add(listener);
    while (pending.length > 0) {
      const next = pending.shift();
      if (next) listener(next);
    }
    return () => {
      listeners.delete(listener);
    };
  },
};
