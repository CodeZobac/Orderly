// Asset generation only: emits the same real geometry used by the sidebar.
import { readFile, writeFile } from "node:fs/promises";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { AnimationClip, Color, QuaternionKeyframeTrack } from "three";
import { createLogoModel, disposeLogoModel } from "../lib/logo-model";
// GLTFExporter uses FileReader in its texture-free binary writer.
class BlobReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
Object.defineProperty(globalThis, "FileReader", {
  value: BlobReader,
  configurable: true,
});
async function main() {
  const tokens = await readFile("tokens.css", "utf8");
  function tokenColor(name: string) {
    const match = tokens
      .split("\n")
      .find((line) => line.trim().startsWith(name + ":"))
      ?.match(/oklch\(([^)]+)\)/);
    if (!match) throw new Error("Missing brand token: " + name);
    const [lightness, chroma, hue] = match[1].split(/\s+/);
    const L = parseFloat(lightness) / 100,
      C = Number(chroma),
      angle = (Number(hue) * Math.PI) / 180;
    const a = C * Math.cos(angle),
      b = C * Math.sin(angle);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return new Color().setRGB(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    );
  }
  const { root } = createLogoModel({
    ink: tokenColor("--color-ink"),
    amber: tokenColor("--color-accent"),
    paper: tokenColor("--color-paper"),
    muted: tokenColor("--color-muted"),
  });
  const times = [0, 3.25, 6.5, 9.75, 13];
  const values = times.flatMap((time) => {
    const halfAngle = (-Math.PI * time) / 13;
    return [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)];
  });
  const clip = new AnimationClip("Thirteen_second_sweep", 13, [
    new QuaternionKeyframeTrack("Seconds_indicator.quaternion", times, values),
  ]);
  const result = await new GLTFExporter().parseAsync(root, {
    binary: true,
    animations: [clip],
    onlyVisible: true,
  });
  if (!(result instanceof ArrayBuffer))
    throw new Error("Expected a binary glTF asset.");
  await writeFile("public/brand/orderly-13.glb", Buffer.from(result));
  disposeLogoModel(root);
  console.log(
    "Exported public/brand/orderly-13.glb with a 13-second sweep animation.",
  );
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
