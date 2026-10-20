import * as THREE from "three";

export type LogoPalette = {
  ink: THREE.ColorRepresentation;
  amber: THREE.ColorRepresentation;
  paper: THREE.ColorRepresentation;
  muted: THREE.ColorRepresentation;
};
// Shared actual mesh construction for the live sidebar and portable GLB export.
export function createLogoModel(palette: LogoPalette) {
  const root = new THREE.Group();
  root.name = "Orderly_13_and_Clock";
  const numbers = new THREE.Group();
  numbers.name = "Independent_number_13";
  numbers.position.set(-0.72, -0.06, 0);
  const clock = new THREE.Group();
  clock.name = "Independent_clock";
  clock.position.set(1.03, 0, 0);
  clock.scale.setScalar(0.43);
  root.add(numbers, clock);
  const dark = new THREE.MeshStandardMaterial({
    color: palette.ink,
    roughness: 0.34,
    metalness: 0.35,
  });
  const dial = new THREE.MeshStandardMaterial({
    color: palette.ink,
    roughness: 0.9,
    metalness: 0.08,
  });
  const amber = new THREE.MeshStandardMaterial({
    color: palette.amber,
    roughness: 0.27,
    metalness: 0.5,
  });
  const ivory = new THREE.MeshStandardMaterial({
    color: palette.paper,
    roughness: 0.5,
    metalness: 0.1,
  });
  const etched = new THREE.MeshStandardMaterial({
    color: palette.muted,
    roughness: 0.6,
    metalness: 0.25,
  });
  function add(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    clock.add(mesh);
    return mesh;
  }
  const shell = add(
    "Graphite_case",
    new THREE.CylinderGeometry(1.27, 1.22, 0.32, 64),
    dark,
    0,
    0,
    -0.04,
  );
  shell.rotation.x = Math.PI / 2;
  add(
    "Amber_bezel",
    new THREE.TorusGeometry(1.18, 0.085, 12, 64),
    amber,
    0,
    0,
    0.13,
  );
  const face = add(
    "Recessed_dial",
    new THREE.CylinderGeometry(1.115, 1.115, 0.08, 64),
    dial,
    0,
    0,
    0.145,
  );
  face.rotation.x = Math.PI / 2;
  add(
    "Inner_etched_ring",
    new THREE.TorusGeometry(1.045, 0.012, 6, 64),
    etched,
    0,
    0,
    0.193,
  );
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    const tick = add(
      `Hour_index_${i + 1}`,
      new THREE.BoxGeometry(
        i % 3 === 0 ? 0.042 : 0.026,
        i % 3 === 0 ? 0.145 : 0.08,
        0.025,
      ),
      i % 3 === 0 ? ivory : etched,
      Math.sin(angle) * 0.965,
      Math.cos(angle) * 0.965,
      0.2,
    );
    tick.rotation.z = -angle;
  }
  // Bespoke raised glyphs. No font loading or raster textures.
  const one = new THREE.Shape();
  one.moveTo(-0.65, 0.48);
  one.lineTo(-0.4, 0.68);
  one.lineTo(-0.22, 0.68);
  one.lineTo(-0.22, -0.4);
  one.lineTo(-0.43, -0.4);
  one.lineTo(-0.43, 0.4);
  one.lineTo(-0.65, 0.24);
  one.closePath();
  const three = new THREE.Shape();
  three.moveTo(-0.03, 0.54);
  three.bezierCurveTo(0.12, 0.74, 0.48, 0.79, 0.67, 0.61);
  three.bezierCurveTo(0.88, 0.4, 0.77, 0.16, 0.59, 0.09);
  three.bezierCurveTo(0.84, 0.01, 0.86, -0.28, 0.67, -0.43);
  three.bezierCurveTo(0.46, -0.61, 0.11, -0.56, -0.06, -0.34);
  three.lineTo(0.11, -0.18);
  three.bezierCurveTo(0.23, -0.32, 0.44, -0.36, 0.53, -0.26);
  three.bezierCurveTo(0.64, -0.13, 0.48, -0.03, 0.2, -0.03);
  three.lineTo(0.2, 0.18);
  three.bezierCurveTo(0.43, 0.18, 0.61, 0.28, 0.52, 0.41);
  three.bezierCurveTo(0.44, 0.52, 0.23, 0.49, 0.12, 0.37);
  three.closePath();
  const glyphOptions = {
    depth: 0.1,
    bevelEnabled: true,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    bevelSegments: 2,
    curveSegments: 12,
    steps: 1,
  };
  const numeralOne = add(
    "Raised_number_1",
    new THREE.ExtrudeGeometry(one, glyphOptions),
    amber,
    0,
    0.03,
    0.22,
  );
  const numeralThree = add(
    "Raised_number_3",
    new THREE.ExtrudeGeometry(three, glyphOptions),
    amber,
    0,
    0.03,
    0.22,
  );
  numbers.add(numeralOne, numeralThree);
  // The clock is a separate object with its own centered hands.
  const hands = new THREE.Group();
  hands.name = "Clock_hands";
  hands.position.set(0, 0, 0.27);
  clock.add(hands);
  function hand(name: string, length: number, width: number, angle: number) {
    const pivot = new THREE.Group();
    pivot.name = name;
    const pointer = new THREE.Mesh(
      new THREE.BoxGeometry(width, length, 0.035),
      ivory,
    );
    pointer.position.y = length / 2;
    pivot.rotation.z = angle;
    pivot.add(pointer);
    hands.add(pivot);
    return pivot;
  }
  hand("Hour_hand_13h", 0.53, 0.055, -Math.PI / 6);
  hand("Minute_hand", 0.78, 0.035, 0);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), amber);
  hands.add(hub);
  const sweep = new THREE.Group();
  sweep.name = "Seconds_indicator";
  clock.add(sweep);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), amber);
  marker.position.set(0, 1.185, 0.235);
  sweep.add(marker);
  // A small crown makes the depth recognizable even at sidebar scale.
  const crown = add(
    "Winding_crown",
    new THREE.CylinderGeometry(0.09, 0.09, 0.16, 12),
    amber,
    1.28,
    0,
    -0.035,
  );
  crown.rotation.z = Math.PI / 2;
  return { root, numbers, clock, sweep };
}
export function disposeLogoModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        materials.add(material);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
