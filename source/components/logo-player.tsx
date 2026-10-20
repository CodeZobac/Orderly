"use client";
import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { LogoComposition, type LogoProps } from "../remotion/logo-composition";
function RestoreFallback({ onFailure }: { onFailure: () => void }) {
  useEffect(onFailure, [onFailure]);
  return null;
}
export default function LogoPlayer({
  palette,
  onReady,
  running,
  onFailure,
}: LogoProps & { running: boolean; onFailure: () => void }) {
  const player = useRef<PlayerRef>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    const sync = () => {
      if (reduced.matches || document.hidden || !visible)
        player.current?.pause();
      else player.current?.play();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    if (container.current) observer.observe(container.current);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return (
    <div ref={container} style={{ width: "100%", height: "100%" }}>
      <Player
        ref={player}
        component={LogoComposition}
        inputProps={{ palette, onReady }}
        compositionWidth={960}
        compositionHeight={640}
        durationInFrames={390}
        fps={30}
        loop
        playbackRate={running ? 1 : 0.5}
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        style={{ width: "100%", height: "100%" }}
        errorFallback={() => <RestoreFallback onFailure={onFailure} />}
      />
    </div>
  );
}
