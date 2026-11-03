import * as THREE from 'three';

/** Preserve Blender's anatomical ear mask and its surface gradient for normals. */
export function installEarWeights(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position');
  const sourceName = Object.keys(geometry.attributes).find(name => name.toLowerCase() === '_earweights');
  const source = sourceName ? geometry.getAttribute(sourceName) : undefined;
  const weights = new Float32Array(position.count * 3);
  const stats = { authored: Boolean(source), leftVertices: 0, rightVertices: 0, maxLeft: 0, maxRight: 0 };
  if (source && source.count === position.count && source.itemSize >= 2) {
    for (let i = 0; i < position.count; i++) {
      const left = THREE.MathUtils.clamp(source.getX(i), 0, 1);
      const right = THREE.MathUtils.clamp(source.getY(i), 0, 1);
      weights[i * 3] = Number.isFinite(left) ? left : 0;
      weights[i * 3 + 1] = Number.isFinite(right) ? right : 0;
      if (left > .001) stats.leftVertices++;
      if (right > .001) stats.rightVertices++;
      stats.maxLeft = Math.max(stats.maxLeft, weights[i * 3]);
      stats.maxRight = Math.max(stats.maxRight, weights[i * 3 + 1]);
    }
  }
  geometry.setAttribute('jellyEarWeights', new THREE.BufferAttribute(weights, 3));

  // Finite-difference normals must include the changing weight along the mesh.
  // The face gradient of a scalar field is averaged at shared vertices.
  const gradients = [new Float32Array(weights.length), new Float32Array(weights.length)];
  const areas = new Float32Array(position.count);
  const index = geometry.getIndex();
  const count = index?.count ?? position.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), normal = new THREE.Vector3();
  const basis1 = new THREE.Vector3(), basis2 = new THREE.Vector3(), gradient = new THREE.Vector3();
  if (stats.leftVertices || stats.rightVertices) {
    for (let face = 0; face < count; face += 3) {
      const ia = index ? index.getX(face) : face;
      const ib = index ? index.getX(face + 1) : face + 1;
      const ic = index ? index.getX(face + 2) : face + 2;
      a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic);
      edge1.subVectors(b, a); edge2.subVectors(c, a); normal.crossVectors(edge1, edge2);
      const areaSquared = normal.lengthSq();
      if (areaSquared < 1e-16) continue;
      const area = Math.sqrt(areaSquared);
      basis1.crossVectors(edge2, normal).divideScalar(area);
      basis2.crossVectors(normal, edge1).divideScalar(area);
      for (const vertex of [ia, ib, ic]) areas[vertex] += area;
      for (let side = 0; side < 2; side++) {
        gradient.copy(basis1).multiplyScalar(weights[ib * 3 + side] - weights[ia * 3 + side]);
        gradient.addScaledVector(basis2, weights[ic * 3 + side] - weights[ia * 3 + side]);
        for (const vertex of [ia, ib, ic]) {
          gradients[side][vertex * 3] += gradient.x;
          gradients[side][vertex * 3 + 1] += gradient.y;
          gradients[side][vertex * 3 + 2] += gradient.z;
        }
      }
    }
    for (let i = 0; i < position.count; i++) {
      if (areas[i] <= 0) continue;
      for (const values of gradients) for (let axis = 0; axis < 3; axis++) values[i * 3 + axis] /= areas[i];
    }
  }
  geometry.setAttribute('jellyEarGradientL', new THREE.BufferAttribute(gradients[0], 3));
  geometry.setAttribute('jellyEarGradientR', new THREE.BufferAttribute(gradients[1], 3));
  return stats;
}
