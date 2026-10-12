import { useAppStore } from "../state.js";

export function StatusBar() {
  const status = useAppStore((s) => s.status);
  return (
    <p
      // Progress and errors are announced, not signalled by colour alone.
      role="status"
      aria-live="polite"
      className="statusbar"
    >
      <span className="statusbar-dot" aria-hidden="true" />
      {status}
    </p>
  );
}
