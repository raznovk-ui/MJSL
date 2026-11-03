import { useAppStore } from "../state.js";

export function StatusBar() {
  const status = useAppStore((s) => s.status);
  return (
    <p
      // Progress and errors are announced, not signalled by colour alone.
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      {status}
    </p>
  );
}
