import * as THREE from 'three';

/** Fade the model with alpha while retaining the original opaque endpoint. */
export function setupOpacity(gel: THREE.MeshPhysicalMaterial, nostril: THREE.MeshPhysicalMaterial, eyes: THREE.MeshPhysicalMaterial, shadow: THREE.MeshBasicMaterial, softShadow: THREE.MeshBasicMaterial, depthPrepass: THREE.Group, onChange: (value: number) => void = () => {}) {
  const input = document.getElementById('jelly-opacity') as HTMLInputElement;
  const label = document.getElementById('jelly-opacity-value') as HTMLOutputElement;
  let value = 1;
  function setOpacity(amount: number) {
    value = THREE.MathUtils.clamp(amount, .20, 1);
    for (const material of [gel, nostril]) {
      const transparent = value < .999;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.transmission = 0;
      material.opacity = value;
      material.depthWrite = !transparent;
    }
    const transparent = value < .999;
    if (eyes.transparent !== transparent) { eyes.transparent = transparent; eyes.needsUpdate = true; }
    // The eyes fade with the body but remain legible as dark embedded beads.
    eyes.opacity = Math.sqrt(value); eyes.depthWrite = !transparent;
    shadow.opacity = .53 * (.25 + value * .75);
    softShadow.opacity = .25 + value * .75;
    depthPrepass.visible = value < .999;
    input.value = String(Math.round(value * 100));
    label.value = `${Math.round(value * 100)}%`;
    input.setAttribute('aria-valuetext', `${Math.round(value * 100)}% 不透明`);
    onChange(value);
  }
  input.addEventListener('input', () => setOpacity(Number(input.value) / 100));
  setOpacity(1);
  return { get value() { return value; }, setOpacity };
}
