import * as THREE from 'three';

export type JellyLookVariant = 'warm-reflection' | 'warm-scatter' | 'cream-scatter' | 'depth-scatter' | 'depth-surface-only';
declare global { interface Window { __JELLY_LOOK_VARIANT__?: JellyLookVariant; } }
export const jellyLookVariant: JellyLookVariant = window.__JELLY_LOOK_VARIANT__ ?? 'cream-scatter';
const cream = jellyLookVariant === 'cream-scatter';
export const useDepthTransport = jellyLookVariant.startsWith('depth-');
export const jellyLook = {
  revision: useDepthTransport ? 'geometric-depth-scatter-v13-softbox' : 'milky-' + jellyLookVariant + '-v2',
  background: useDepthTransport ? [.16, .155, .16] : cream ? [.145, .14, .135] : [.14, .135, .14],
  bodyColor: useDepthTransport ? '#bda8a7' : cream ? '#c8b7b4' : '#c6b3b5',
  roughness: useDepthTransport ? .24 : .105,
  clearcoat: useDepthTransport ? .35 : .80,
  clearcoatRoughness: useDepthTransport ? .15 : .055,
  scatterStrength: jellyLookVariant === 'depth-surface-only' ? 0 : useDepthTransport ? 6.4 : cream ? 1.2 : jellyLookVariant === 'warm-scatter' ? .68 : 0,
  scatterColor: cream ? '#fff0ce' : '#ffcc8f',
  scatterEdgePower: cream ? .85 : 1.25,
  scatterFill: cream ? .22 : .12,
  panels: useDepthTransport ? [
    { position: [-3.8, 4.7, 5.2], size: [5.5, 6.5], color: [5.2, 5.05, 5.2] },
    { position: [4.5, 2.8, 3.8], size: [5.0, 5.0], color: [.50, .50, .52] },
    { position: [0.0, .8, -4.0], size: [9.2, 6.6], color: [2.0, 1.94, 1.84] },
    { position: [3.8, .9, -1.9], size: [3.8, 4.0], color: [.60, .58, .54], transportColor: [2.6, 2.5, 2.3] },
    { position: [-1.8, -2.0, 2.0], size: [5.0, 3.0], color: [.75, .65, .55] },
  ] : [
    { position: [-3.8, 4.7, 5.2], size: [5.4, 6.5], color: [8.2, 7.8, 7.4] },
    { position: [4.5, 2.8, 3.8], size: [5.0, 5.0], color: [.8, .8, .84] },
    { position: [-3.5, 2.2, -3.4], size: [4.2, 4.8], color: [5.2, 3.1, 1.6] },
    { position: [-1.8, -2.0, 2.0], size: [4.0, 3.0], color: [1.1, .62, .28] },
  ],
};

/** Light-dependent diffuse scattering approximation; no transparency or emission. */
export function applyMilkyLook<T extends THREE.MeshPhysicalMaterial>(material: T): T {
  if (useDepthTransport) return material;
  const deform = material.onBeforeCompile;
  const deformKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    deform(shader, renderer);
    if (jellyLook.scatterStrength === 0) return;
    const backbox = jellyLook.panels[2];
    const sourceEnergy = backbox.color[0] * .2126 + backbox.color[1] * .7152 + backbox.color[2] * .0722;
    shader.uniforms.uGelScatterStrength = { value: jellyLook.scatterStrength * sourceEnergy / 3.43816 };
    shader.uniforms.uGelScatterColor = { value: new THREE.Color(jellyLook.scatterColor) };
    shader.uniforms.uGelBackDirection = { value: new THREE.Vector3().fromArray(backbox.position).normalize() };
    shader.uniforms.uGelScatterEdgePower = { value: jellyLook.scatterEdgePower };
    shader.uniforms.uGelScatterFill = { value: jellyLook.scatterFill };
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
      varying vec3 vGelPosition;
      varying float vGelEarWeight;
      void main() {
        vGelPosition = position;
        vGelEarWeight = max(jellyEarWeights.x, jellyEarWeights.y);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uGelScatterStrength;
      uniform vec3 uGelScatterColor;
      uniform vec3 uGelBackDirection;
      uniform float uGelScatterEdgePower;
      uniform float uGelScatterFill;
      varying vec3 vGelPosition;
      varying float vGelEarWeight;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      // The source direction matches the warm rear softbox in the environment.
      // Its angular response changes with the actual view and surface normal.
      vec3 gelBackDirection = normalize((viewMatrix * vec4(uGelBackDirection,0.0)).xyz);
      float gelNL = dot(normal,gelBackDirection);
      float gelWrap = max((gelNL+.45)/1.45,0.0);
      float gelWrappedExtra = max(gelWrap-max(gelNL,0.0),0.0);
      float gelBacklit = max(-gelNL,0.0);
      float gelEdge = pow(1.0-clamp(dot(normal,geometryViewDir),0.0,1.0),uGelScatterEdgePower);
      float gelNose = smoothstep(1.08,1.72,vGelPosition.z) * (1.0-smoothstep(.30,.64,abs(vGelPosition.x)));
      float gelPads = 1.0-smoothstep(.18,.62,vGelPosition.y);
      float gelThin = max(smoothstep(.02,.80,vGelEarWeight),max(gelNose*.70,gelPads*.42));
      float gelTransport = gelThin*(uGelScatterFill+(1.0-uGelScatterFill)*gelEdge)*(gelBacklit*.80+gelWrap*.25);
      reflectedLight.indirectDiffuse += material.diffuseColor * uGelScatterColor * uGelScatterStrength * (gelTransport+gelWrappedExtra*.08);
    `);
  };
  material.customProgramCacheKey = () => deformKey + '-milky-' + jellyLookVariant;
  return material;
}
