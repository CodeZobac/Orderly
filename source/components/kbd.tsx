"use client";
import { useSyncExternalStore, type ReactNode } from "react";

/** A single keycap. Purely presentational; pair with visible text for meaning. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

const subscribe = () => () => {};
const isApple = () =>
  /Mac|iPhone|iPad|iPod/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform || navigator.platform,
  );

/** True on Apple platforms after hydration; the server renders the Ctrl variant. */
export function useAppleKeys() {
  return useSyncExternalStore(subscribe, isApple, () => false);
}

/** The platform modifier plus a key, e.g. ⌘ K on macOS and Ctrl K elsewhere. */
export function ModKbd({ keyLabel }: { keyLabel: string }) {
  const apple = useAppleKeys();
  return (
    <span className="kbd-combo">
      <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
      <Kbd>{keyLabel}</Kbd>
    </span>
  );
}
