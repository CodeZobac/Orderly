import { useEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { createLogoModel, disposeLogoModel } from "../lib/logo-model";

export type LogoProps = {
  palette: { ink: string; amber: string; paper: string; muted: string };
  onReady?: () => void;
};
export const defaultPalette = {
  ink: "#242724",
  amber: "#bd7020",
  paper: "#faf6ee",
  muted: "#77786e",
};
export function LogoComposition({ palette, onReady }: LogoProps) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const model = useMemo(() => createLogoModel(palette), [palette]);
  useEffect(
    () => () => {
      disposeLogoModel(model.numbers);
      disposeLogoModel(model.clock);
    },
    [model],
  );
  const phase = (frame / durationInFrames) * Math.PI * 2;
  // All motion is frame-driven: Studio seeking and the embedded Player agree.
  return (
    <ThreeCanvas
      width={width}
      height={height}
      orthographic
      camera={{ position: [0, 0, 8], zoom: height / 2.15 }}
      gl={{ alpha: true, antialias: true }}
      onCreated={onReady}
    >
      <ambientLight intensity={2.4} />
      <directionalLight
        position={[-3, 4, 5]}
        intensity={4}
        color={palette.paper}
      />
      <directionalLight
        position={[4, 1, 3]}
        intensity={2}
        color={palette.amber}
      />
      <primitive
        object={model.numbers}
        rotation={[
          0.12 + Math.sin(phase) * 0.04,
          -0.2 + Math.sin(phase) * 0.12,
          -0.025,
        ]}
      />
      <primitive
        object={model.clock}
        rotation={[0.12, -0.18 + Math.sin(phase) * 0.04, 0]}
      >
        <primitive object={model.sweep} rotation={[0, 0, -phase]} />
      </primitive>
    </ThreeCanvas>
  );
}
