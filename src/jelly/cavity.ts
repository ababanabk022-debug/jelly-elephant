import * as THREE from 'three';

/** Surface distance from the material boundary, so color never exposes its facets. */
export function installCavityDepth(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position'), index = geometry.index;
  const groups = new Map<string, number>(), originalToWelded: number[] = [], points: THREE.Vector3[] = [];
  for (let i=0;i<p.count;i++) {
    const point = new THREE.Vector3().fromBufferAttribute(p,i), key = point.toArray().map(n=>Math.round(n*100000)).join(',');
    let id=groups.get(key); if(id===undefined){id=points.length;groups.set(key,id);points.push(point);} originalToWelded.push(id);
  }
  const edges = new Map<string,{a:number;b:number;count:number}>();
  const count = index?.count ?? p.count;
  for(let i=0;i<count;i+=3){const ids=[0,1,2].map(k=>originalToWelded[index?index.getX(i+k):i+k]);for(let k=0;k<3;k++){const a=Math.min(ids[k],ids[(k+1)%3]),b=Math.max(ids[k],ids[(k+1)%3]),key=a+','+b;const e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1});}}
  const distance=new Float32Array(points.length).fill(Infinity), neighbors:Array<Array<[number,number]>>=points.map(()=>[]);
  for(const edge of edges.values()){const length=points[edge.a].distanceTo(points[edge.b]);neighbors[edge.a].push([edge.b,length]);neighbors[edge.b].push([edge.a,length]);if(edge.count===1){distance[edge.a]=0;distance[edge.b]=0;}}
  // Small cavity mesh: repeated relaxation is predictable and avoids an added dependency.
  for(let iteration=0;iteration<100;iteration++){let changed=false;for(let i=0;i<points.length;i++)for(const [other,length] of neighbors[i])if(distance[other]>distance[i]+length){distance[other]=distance[i]+length;changed=true;}if(!changed)break;}
  geometry.setAttribute('jellyCavityDepth',new THREE.Float32BufferAttribute(originalToWelded.map(i=>Number.isFinite(distance[i])?distance[i]:0),1));
  return { boundaryVertices:Array.from(distance).filter(d=>d===0).length,maxDistance:Math.max(...Array.from(distance).filter(Number.isFinite)) };
}
export function applyCavityLook<T extends THREE.MeshPhysicalMaterial>(material:T):T{
  material.userData.jellyCavity=true;
  const before=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{before(shader,renderer);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float jellyCavityDepth; varying float vCavityDepth;');
    shader.vertexShader=shader.vertexShader.replace('void main() {','void main() {\nvCavityDepth=jellyCavityDepth;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vCavityDepth;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\ndiffuseColor.rgb*=mix(vec3(1.0),vec3(.35,.24,.19),smoothstep(.015,.18,vCavityDepth));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.34,smoothstep(.015,.18,vCavityDepth));`);
  };material.customProgramCacheKey=()=>key+'-cavity-boundary-blend-v1';return material;
}
