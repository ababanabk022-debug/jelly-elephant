import * as THREE from 'three';
import { DEFAULT_SUPPORT_FEET } from './support';

export const jellyUniforms = {
  uFootCenters: { value: DEFAULT_SUPPORT_FEET.map(([x,z])=>new THREE.Vector2(x,z)) },
  uBodyDrop: { value: 0 },
  uBodyTilt: { value: new THREE.Vector2() },
  uFootCompression: { value: new THREE.Vector4() },
  uFootLift: { value: new THREE.Vector4() },
  uJellySquash: { value: 0 },
  uJellySway: { value: new THREE.Vector2() },
  uJellyAppendages: { value: new THREE.Vector3() },
  uJellyTouch: { value: new THREE.Vector3(0, 1.3, 1) },
  uJellyForce: { value: new THREE.Vector3() },
  uJellyPull: { value: new THREE.Vector3() },
  uJellyRadius: { value: .74 },
};

const deformation = /* glsl */`
uniform vec2 uFootCenters[4];
uniform float uBodyDrop;
uniform vec2 uBodyTilt;
uniform vec4 uFootCompression;
uniform vec4 uFootLift;
uniform float uJellySquash;
uniform vec2 uJellySway;
uniform vec3 uJellyAppendages;
uniform vec3 uJellyTouch;
uniform vec3 uJellyForce;
uniform vec3 uJellyPull;
uniform float uJellyRadius;
attribute vec3 jellyEarWeights;
attribute vec3 jellyEarGradientL;
attribute vec3 jellyEarGradientR;
vec3 jellyDeform(vec3 original, vec2 earWeights) {
  vec3 p = original;
  float anchor = smoothstep(0.025, 0.50, p.y);
  float vertical = clamp(1.0 - uJellySquash * 0.26, 0.70, 1.15);
  float horizontal = inversesqrt(vertical);
  p.x *= mix(1.0, horizontal, anchor);
  p.z *= mix(1.0, horizontal, anchor);
  p.y *= vertical;
  float upper = smoothstep(0.04, 2.9, original.y);
  p.x += uJellySway.x * upper;
  p.z += uJellySway.y * upper;
  vec3 delta = original - uJellyTouch;
  float influence = exp(-dot(delta, delta) / (uJellyRadius * uJellyRadius));
  // A hand can deform the soft torso, but should not drag the loaded soles
  // through the floor. Fade local displacement above the short foot columns.
  float touchAnchor = smoothstep(.30, 1.15, original.y);
  p += uJellyForce * influence * touchAnchor;
  // Keep the whole sole planted while progressively carrying the torso and
  // head with the hand. Above the shoulders the translation is uniform.
  float pullWeight = smoothstep(.12, 1.55, original.y);
  p += uJellyPull * pullWeight;
  // Authored weights keep the shoulder and ear roots still while the lobe lags.
  float earMotion = dot(clamp(earWeights, 0.0, 1.0), uJellyAppendages.xy);
  p.z += earMotion;
  p.y += earMotion * .35;
  float trunk = smoothstep(.98, 1.65, original.z) * (1.0 - smoothstep(.28, .58, abs(original.x))) * smoothstep(1.10, 1.65, original.y);
  p.y += trunk * uJellyAppendages.z;
  p.z -= trunk * uJellyAppendages.z * .34;
  // Gravity settlement shortens the lower support, leaving loaded soles on
  // the floor. Each pad expands sideways according to its own compression.
  float supportDrop = uBodyDrop + uBodyTilt.x * original.x + uBodyTilt.y * (original.z + .10);
  float supportBlend = smoothstep(0.0, .70, max(0.0, original.y));
  p.y -= supportDrop * supportBlend;
  for(int i=0;i<4;i++){
    vec2 relative=original.xz-uFootCenters[i];
    float radial=1.0-smoothstep(.28,.53,length(relative));
    float footWeight=radial*(1.0-smoothstep(.20,.62,original.y));
    float compression=clamp(uFootCompression[i],0.0,.32);
    float spread=sqrt(.72/max(.40,.72-compression))-1.0;
    p.xz+=relative*spread*footWeight;
    p.y+=uFootLift[i]*footWeight*(1.0-supportBlend);
  }
  p.y = max(0.001, p.y);
  return p;
}
vec3 jellyDeform(vec3 original) { return jellyDeform(original, jellyEarWeights.xy); }
vec3 jellyNormal(vec3 p, vec3 n) {
  vec3 ref = abs(n.y) < .86 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 tangent = normalize(cross(ref,n));
  vec3 bitangent = normalize(cross(n,tangent));
  vec3 base = jellyDeform(p);
  vec2 tangentWeights = jellyEarWeights.xy + vec2(dot(jellyEarGradientL,tangent),dot(jellyEarGradientR,tangent))*.007;
  vec2 bitangentWeights = jellyEarWeights.xy + vec2(dot(jellyEarGradientL,bitangent),dot(jellyEarGradientR,bitangent))*.007;
  return normalize(cross(jellyDeform(p+tangent*.007,tangentWeights)-base, jellyDeform(p+bitangent*.007,bitangentWeights)-base));
}
`;

export function deformMaterial<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, jellyUniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + deformation);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = jellyDeform(position);');
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `vec3 objectNormal = jellyNormal(position, normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif`);
  };
  material.customProgramCacheKey = () => 'jelly-deform-v6-authored-foot-centers';
  return material;
}
