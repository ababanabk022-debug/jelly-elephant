import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JellyPhysics } from './physics';
import { deformMaterial, jellyUniforms } from './deform';
import { ContactShadow } from './contactShadow';
import { installEarWeights } from './ears';
import { applyMilkyLook, jellyLook, jellyLookVariant, useDepthTransport } from './look';
import { JellyLightTransport } from './lightTransport';
import { applyCavityLook, installCavityDepth } from './cavity';
import './style.css';

declare global { interface Window { __JELLY_MODEL_BASE64__?: string; jellyZoo: ReturnType<typeof createApi>; } }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('jelly-canvas');
const loading = $('loading');
const note = $('interaction-note');
const softnessInput = $<HTMLInputElement>('softness');
const physics = new JellyPhysics();
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
physics.reducedMotion = motionPreference.matches;
motionPreference.addEventListener('change', () => { physics.reducedMotion = motionPreference.matches; physics.reset(); });
let ready = false, loadError: string | null = null, disposed = false;
let mode: 'squish' | 'orbit' = 'squish';
let interaction: 'idle' | 'press' | 'orbit' | 'pinch' = 'idle';
let pointerId: number | null = null;
let rotation = 0, rotationTarget = 0;
let cameraZoom = 1, zoomTarget = 1, cameraDistance = 10;
const zoomBounds = { min: .72, max: 2.1 };
const cameraDirection = new THREE.Vector3(-.20, .165, .98).normalize();
const cameraTarget = new THREE.Vector3();
const touchPointers = new Map<number, THREE.Vector2>();
let pinchActive = false, pinchStartDistance = 0, pinchStartZoom = 1;
let elapsed = 0, lastTime = performance.now(), frameId = 0, drawCount = 0;
let modelHeight = 3, modelWidth = 3, modelDepth = 3.2;
let shadowNeedsUpdate = true;
const modelMeshes: THREE.Mesh[] = [];
const earWeights = { authoredMeshes: 0, leftVertices: 0, rightVertices: 0, maxLeft: 0, maxRight: 0 };
const resources: Array<{ dispose(): void }> = [];
const scene = new THREE.Scene();
scene.background = new THREE.Color('#fbfaf9');
const camera = new THREE.PerspectiveCamera(31, 1, .1, 80);
camera.position.set(-3.1, 3.05, 9.2);
camera.lookAt(0, 1.45, .08);
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  loading.classList.add('error');
  $('loading-text').textContent = '需要浏览器的图形加速来照顾这只小象。请使用已开启硬件加速的 Chrome 或 Edge。';
  $<HTMLButtonElement>('retry').hidden = false;
  $('retry').addEventListener('click', () => location.reload());
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#fbfaf9', 1);
const actor = new THREE.Group();
scene.add(actor);

function makeStudioEnvironment() {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color().fromArray(jellyLook.background);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(24, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color().fromArray(jellyLook.background), side: THREE.BackSide }));
  studio.add(sphere);
  const panels: THREE.Mesh[] = [];
  const panel = (position: number[], size: number[], color: number[]) => {
    let map:THREE.DataTexture|null=null;
    if(useDepthTransport){
      const count=128,pixels=new Uint8Array(count*count*4),feather=panels.length===0?.13:.38;
      for(let y=0;y<count;y++)for(let x=0;x<count;x++){
        const u=(x+.5)/count,v=(y+.5)/count;
        const fade=THREE.MathUtils.smoothstep(Math.min(u,1-u),0,feather)*THREE.MathUtils.smoothstep(Math.min(v,1-v),0,feather);
        const offset=(y*count+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=Math.round(fade*255);pixels[offset+3]=255;
      }
      map=new THREE.DataTexture(pixels,count,count);map.minFilter=THREE.LinearFilter;map.magFilter=THREE.LinearFilter;map.needsUpdate=true;
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ map, color: new THREE.Color(color[0], color[1], color[2]), side: THREE.DoubleSide }));
    mesh.position.fromArray(position); mesh.lookAt(0, 1, 0); studio.add(mesh); panels.push(mesh);
  };
  // Large softboxes supply both the diffuse shape and broad wet reflections.
  // A darker surrounding studio preserves gentle shadow-side definition.
  for (const softbox of jellyLook.panels) panel(softbox.position, softbox.size, softbox.color);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(studio, .035, .1, 100);
  scene.environment = target.texture;
  resources.push(target);
  sphere.geometry.dispose(); (sphere.material as THREE.Material).dispose();
  for (const mesh of panels) { mesh.geometry.dispose(); (mesh.material as THREE.MeshBasicMaterial).map?.dispose(); (mesh.material as THREE.Material).dispose(); }
  pmrem.dispose();
}
makeStudioEnvironment();
scene.add(new THREE.HemisphereLight(0xfff9f2, 0xd2bdb0, .25));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#fbfaf9', toneMapped: false }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -.008; scene.add(floor);
const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x9f8b82, opacity: .14 }));
shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = -.005; shadowPlane.receiveShadow = true;
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 256;
const shadowContext = shadowCanvas.getContext('2d')!;
const gradient = shadowContext.createRadialGradient(128, 128, 5, 128, 128, 125);
gradient.addColorStop(0, 'rgba(115,82,63,.08)'); gradient.addColorStop(.35, 'rgba(123,95,79,.04)'); gradient.addColorStop(1, 'rgba(132,111,93,0)');
shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 256, 256);
const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 3.5), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }));
contactShadow.rotation.x = -Math.PI / 2; contactShadow.position.set(0, -.001, -.04); scene.add(contactShadow);
resources.push(shadowTexture, floor.geometry, floor.material, shadowPlane.geometry, shadowPlane.material, contactShadow.geometry, contactShadow.material);
const softShadow = new ContactShadow(renderer, scene); resources.push(softShadow);
const lightTransport = useDepthTransport ? new JellyLightTransport(renderer, scene) : null;
if (lightTransport) resources.push(lightTransport);

const depth = deformMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
const distance = deformMaterial(new THREE.MeshDistanceMaterial());
resources.push(depth, distance);
const gel = applyMilkyLook(deformMaterial(new THREE.MeshPhysicalMaterial({ color: jellyLook.bodyColor, metalness: 0, roughness: jellyLook.roughness, ior: 1.45, transmission: 0, transparent: false, opacity: 1, clearcoat: jellyLook.clearcoat, clearcoatRoughness: jellyLook.clearcoatRoughness, envMapIntensity: 1.0, specularIntensity: 1.0 })));
const eyes = deformMaterial(new THREE.MeshPhysicalMaterial({ color: '#3f261b', roughness: .17, metalness: 0, transmission: 0, transparent: false, opacity: 1, ior: 1.46, clearcoat: .65, clearcoatRoughness: .11, envMapIntensity: .90 }));
const nostril = useDepthTransport
  ? applyCavityLook(deformMaterial(new THREE.MeshPhysicalMaterial({ color: jellyLook.bodyColor, roughness: jellyLook.roughness, metalness: 0, transmission: 0, transparent: false, opacity: 1, ior: 1.45, clearcoat: jellyLook.clearcoat, clearcoatRoughness: jellyLook.clearcoatRoughness, envMapIntensity: 1.0 })))
  : deformMaterial(new THREE.MeshPhysicalMaterial({ color: '#a47d6c', roughness: .30, metalness: 0, transmission: 0, transparent: false, opacity: 1, ior: 1.42, clearcoat: .20, clearcoatRoughness: .18, envMapIntensity: .80 }));
if (lightTransport) { lightTransport.apply(gel); lightTransport.apply(nostril); }
resources.push(gel, eyes, nostril);
const colorInput = $<HTMLInputElement>('jelly-color');
const originalColor = jellyLook.bodyColor;
function setElephantColor(color: string, persist = true) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  gel.color.set(color); nostril.color.set(color);
  if (!useDepthTransport) nostril.color.multiplyScalar(.70);
  colorInput.value = color;
  if (persist) { try { localStorage.setItem('jelly-elephant-color', color); } catch { /* Storage is optional. */ } }
}
try { setElephantColor(localStorage.getItem('jelly-elephant-color') || originalColor, false); }
catch { setElephantColor(originalColor, false); }
colorInput.addEventListener('input', () => setElephantColor(colorInput.value));
$<HTMLButtonElement>('jelly-color-reset').addEventListener('click', () => {
  setElephantColor(originalColor, false);
  try { localStorage.removeItem('jelly-elephant-color'); } catch { /* Storage is optional. */ }
});

function decodeBase64(encoded: string) {
  const clean = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded;
  const bytes = atob(clean), array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return array.buffer;
}
async function loadModel() {
  try {
    const loader = new GLTFLoader();
    const gltf = window.__JELLY_MODEL_BASE64__
      ? await loader.parseAsync(decodeBase64(window.__JELLY_MODEL_BASE64__), '')
      : await loader.loadAsync('/models/jelly-elephant.glb');
    const authoredFeet = gltf.scene.getObjectByName('JellyElephant')?.userData.jelly_support_feet;
    if (authoredFeet !== undefined) {
      if (typeof authoredFeet !== 'string') throw new Error('模型的承重脚位格式不正确');
      physics.support.setCenters(JSON.parse(authoredFeet));
      physics.support.centers.forEach((center, index) => jellyUniforms.uFootCenters.value[index].set(...center));
    }
    gltf.scene.updateMatrixWorld(true);
    // GLTFLoader's bounding box includes the extremes of every Morph Target,
    // even when all weights are zero. Measure the actual neutral positions:
    // using that conservative box here would lift the whole elephant above
    // the ground by its maximum squash displacement.
    const bounds = new THREE.Box3();
    const neutralPoint = new THREE.Vector3();
    gltf.scene.traverse(node => {
      const source = node as THREE.Mesh;
      if (!source.isMesh) return;
      const positions = source.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        neutralPoint.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld);
        bounds.expandByPoint(neutralPoint);
      }
    });
    const height = bounds.max.y - bounds.min.y;
    modelHeight = height; modelWidth = bounds.max.x - bounds.min.x; modelDepth = bounds.max.z - bounds.min.z;
    const shift = new THREE.Matrix4().makeTranslation(0, -bounds.min.y, 0);
    gltf.scene.traverse(node => {
      const source = node as THREE.Mesh;
      if (!source.isMesh) return;
      const geometry = source.geometry.clone();
      geometry.morphAttributes = {};
      geometry.morphTargetsRelative = false;
      geometry.applyMatrix4(shift.clone().multiply(source.matrixWorld));
      const earStats = installEarWeights(geometry);
      earWeights.authoredMeshes += Number(earStats.authored);
      earWeights.leftVertices += earStats.leftVertices; earWeights.rightVertices += earStats.rightVertices;
      earWeights.maxLeft = Math.max(earWeights.maxLeft, earStats.maxLeft); earWeights.maxRight = Math.max(earWeights.maxRight, earStats.maxRight);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const sourceMat = Array.isArray(source.material) ? source.material[0] : source.material;
      const label = source.name + ' ' + sourceMat.name;
      const material = /eye/i.test(label) ? eyes : /nostril|interior/i.test(label) ? nostril : gel;
      if (useDepthTransport && material === nostril) installCavityDepth(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = source.name;
      mesh.layers.enable(1);
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
      mesh.customDepthMaterial = depth; mesh.customDistanceMaterial = distance;
      actor.add(mesh); modelMeshes.push(mesh); resources.push(geometry);
    });
    gltf.scene.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) { mesh.geometry.dispose(); const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; materials.forEach(material => material.dispose()); }
    });
    if (modelMeshes.length < 3 || !Number.isFinite(height)) throw new Error('模型没有完整载入');
    resize();
    renderer.compile(scene, camera);
    ready = true; document.body.classList.add('ready'); loading.classList.add('done');
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    console.error('Jelly elephant loading failed', error);
    loading.classList.add('error'); $('loading-text').textContent = '小象还没能到达。请用支持 WebGL 的 Chrome 或 Edge 打开完整离线文件。';
    $<HTMLButtonElement>('retry').hidden = false;
  }
}
$('retry').addEventListener('click', () => location.reload());

function resize() {
  const width = innerWidth, height = innerHeight;
  renderer.setSize(width, height); camera.aspect = width / height;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const fitHeight = modelHeight + (width < 761 ? 2.0 : 3.15);
  const fitWidth = (Math.max(modelWidth, modelDepth) + .75) / camera.aspect;
  cameraDistance = 1.17 * Math.max(fitHeight, fitWidth) / (2 * Math.tan(verticalFov / 2));
  cameraTarget.set(0, modelHeight * .49, .03);
  // Reserve the same toolbar clearance when the nearer rear feet face us.
  if (width >= 761) camera.setViewOffset(width, height, 0, 25, width, height);
  else camera.clearViewOffset();
  updateCamera();
  shadowNeedsUpdate = true;
}
function updateCamera() {
  camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance / cameraZoom);
  camera.lookAt(cameraTarget); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function setZoom(value: number) {
  zoomTarget = THREE.MathUtils.clamp(value, zoomBounds.min, zoomBounds.max);
  $('zoom-label').textContent = Math.round(zoomTarget * 100) + '%';
  $('zoom-reset').setAttribute('aria-label', '当前缩放 ' + Math.round(zoomTarget * 100) + '%，恢复默认距离');
  $<HTMLButtonElement>('zoom-out').disabled = zoomTarget <= zoomBounds.min + .001;
  $<HTMLButtonElement>('zoom-in').disabled = zoomTarget >= zoomBounds.max - .001;
}
addEventListener('resize', resize); resize();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pressStart = new THREE.Vector2(), lastPointer = new THREE.Vector2();
const dragOrigin = new THREE.Vector3(), pressNormal = new THREE.Vector3();
const dragPlane = new THREE.Plane();
const localDelta = new THREE.Vector3();
const worldIntersection = new THREE.Vector3();
let pressSince = 0, moved = 0, lastMoveAt = 0, lastHoverAt = 0;
function setRay(event: Pick<PointerEvent, 'clientX' | 'clientY'>) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function setMode(next: 'squish' | 'orbit') {
  releasePointer(); mode = next;
  for (const key of ['squish', 'orbit'] as const) { const button = $('mode-' + key); button.classList.toggle('active', key === mode); button.setAttribute('aria-pressed', String(key === mode)); }
  note.textContent = mode === 'squish' ? '按住捏一捏，松手看它回弹。' : '慢慢转个圈，看看它的另一面。';
}
function releasePrimary(releaseCapture = true) {
  const id = pointerId;
  pointerId = null; interaction = 'idle'; physics.release(); canvas.classList.remove('holding');
  if (releaseCapture && id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
function releasePointer() {
  pinchActive = false;
  const ids = [...touchPointers.keys()]; touchPointers.clear();
  releasePrimary();
  for (const id of ids) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerdown', event => {
  if (!ready || event.button !== 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  if (event.pointerType === 'touch') {
    touchPointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
    canvas.setPointerCapture(event.pointerId);
    if (touchPointers.size >= 2) {
      releasePrimary(false);
      const points = [...touchPointers.values()];
      pinchStartDistance = Math.max(16, points[0].distanceTo(points[1])); pinchStartZoom = zoomTarget;
      pinchActive = true; interaction = 'pinch'; canvas.classList.add('holding');
      note.textContent = '双指轻轻开合，靠近看看。'; return;
    }
  }
  if (pointerId !== null || pinchActive) return;
  actor.updateMatrixWorld(true); setRay(event);
  const hit = raycaster.intersectObjects(modelMeshes, false)[0];
  pointerId = event.pointerId; canvas.setPointerCapture(pointerId); pressStart.set(event.clientX, event.clientY); lastPointer.copy(pressStart); moved = 0; pressSince = elapsed; lastMoveAt = performance.now();
  canvas.classList.add('holding');
  if (mode === 'squish' && hit) {
    interaction = 'press';
    physics.pullHeld = true;
    jellyUniforms.uJellyTouch.value.copy(actor.worldToLocal(hit.point.clone()));
    physics.setPressPoint(jellyUniforms.uJellyTouch.value.x, jellyUniforms.uJellyTouch.value.z);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    pressNormal.copy(hit.face?.normal ?? new THREE.Vector3(0, 0, 1)).applyMatrix3(normalMatrix).normalize();
    pressNormal.transformDirection(actor.matrixWorld.clone().invert());
    dragOrigin.copy(hit.point); const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, hit.point);
    physics.squash.target = .35; physics.squash.velocity += .8;
    for (let i = 0; i < 3; i++) physics.force[i].target = -pressNormal.getComponent(i) * .20;
    note.textContent = '软软的。试着轻轻拉一拉。';
  } else { interaction = 'orbit'; note.textContent = '每一面，都软乎乎。'; }
});
canvas.addEventListener('pointermove', event => {
  if (!ready) return;
  if (touchPointers.has(event.pointerId)) touchPointers.get(event.pointerId)!.set(event.clientX, event.clientY);
  if (pinchActive) {
    const points = [...touchPointers.values()];
    if (points.length >= 2) setZoom(pinchStartZoom * points[0].distanceTo(points[1]) / pinchStartDistance);
    return;
  }
  if (pointerId === null) {
    if (event.pointerType === 'mouse' && performance.now() - lastHoverAt > 65) { lastHoverAt = performance.now(); setRay(event); actor.updateMatrixWorld(true); canvas.classList.toggle('touching', !!raycaster.intersectObjects(modelMeshes, false)[0]); }
    return;
  }
  if (event.pointerId !== pointerId) return;
  moved = Math.max(moved, Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y));
  const dx = event.clientX - lastPointer.x;
  if (interaction === 'orbit') rotationTarget += dx * .008;
  else if (interaction === 'press') {
    setRay(event);
    if (raycaster.ray.intersectPlane(dragPlane, worldIntersection)) {
      localDelta.copy(worldIntersection).sub(dragOrigin);
      const inverse = actor.quaternion.clone().invert(); localDelta.applyQuaternion(inverse);
      // Dragging the upper body stretches the whole character while the
      // feet stay anchored. A downward pull is bounded by the floor.
      const pullWeight = THREE.MathUtils.smoothstep(jellyUniforms.uJellyTouch.value.y, .45, 1.35);
      physics.pull[0].target = THREE.MathUtils.clamp(localDelta.x * .9, -1.45, 1.45) * pullWeight;
      physics.pull[1].target = THREE.MathUtils.clamp(localDelta.y * .9, -.12, 1.05) * pullWeight;
      physics.pull[2].target = THREE.MathUtils.clamp(localDelta.z * .9, -1.15, 1.15) * pullWeight;
      localDelta.clampLength(0, .38);
      const strength = .18 + physics.softness * .11;
      for (let i = 0; i < 3; i++) physics.force[i].target = THREE.MathUtils.clamp(localDelta.getComponent(i) * .55 - pressNormal.getComponent(i) * strength, -.28, .28);
      physics.squash.target = THREE.MathUtils.clamp(.36 - localDelta.y * .55, -.25, .52);
      physics.swayX.target = localDelta.x * .44; physics.swayZ.target = localDelta.z * .35;
    }
  }
  lastPointer.set(event.clientX, event.clientY); lastMoveAt = performance.now();
});
function pointerEnd(event: PointerEvent) {
  if (pinchActive && touchPointers.has(event.pointerId)) { releasePointer(); note.textContent = '靠近一点，还是退远一点。'; return; }
  touchPointers.delete(event.pointerId);
  if (event.pointerId !== pointerId) return;
  if (interaction === 'press' && moved < 8 && elapsed - pressSince < .26) physics.squash.velocity += 1.15;
  releasePointer(); note.textContent = mode === 'squish' ? '它会慢慢弹回来。' : '慢慢转个圈，看看它的另一面。';
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', () => releasePointer());
canvas.addEventListener('lostpointercapture', event => { if (pointerId === event.pointerId || (pinchActive && touchPointers.has(event.pointerId))) releasePointer(); });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  if (!ready) return;
  event.preventDefault(); releasePointer();
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  setZoom(zoomTarget * Math.exp(-THREE.MathUtils.clamp(pixels, -240, 240) * .0017));
}, { passive: false });
addEventListener('blur', releasePointer);
function poke() { if (!ready) return; releasePointer(); jellyUniforms.uJellyForce.value.set(0, 0, 0); physics.poke(); note.textContent = '噗，弹一下。'; }
function reset() { releasePointer(); physics.reset(); rotationTarget = rotation = 0; actor.rotation.y = 0; setZoom(1); shadowNeedsUpdate = true; note.textContent = mode === 'squish' ? '按住捏一捏，松手看它回弹。' : '慢慢转个圈，看看它的另一面。'; }
$('mode-squish').addEventListener('click', () => setMode('squish'));
$('mode-orbit').addEventListener('click', () => setMode('orbit'));
$('bounce').addEventListener('click', poke); $('reset').addEventListener('click', reset);
$('zoom-in').addEventListener('click', () => { releasePointer(); setZoom(zoomTarget * 1.18); });
$('zoom-out').addEventListener('click', () => { releasePointer(); setZoom(zoomTarget / 1.18); });
$('zoom-reset').addEventListener('click', () => { releasePointer(); setZoom(1); });
softnessInput.addEventListener('input', () => {
  physics.softness = Number(softnessInput.value) / 100;
  const word = physics.softness < .30 ? '有点弹' : physics.softness < .75 ? '软软的' : '糯叽叽';
  $('softness-label').textContent = word; softnessInput.setAttribute('aria-valuetext', word);
  jellyUniforms.uJellyRadius.value = .53 + physics.softness * .38;
});
addEventListener('keydown', event => {
  if ((event.target as HTMLElement).matches('input,textarea,select')) return;
  if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) poke(); }
  if (event.code === 'KeyR') reset();
  if (event.key === '+' || event.key === '=') { event.preventDefault(); releasePointer(); setZoom(zoomTarget * 1.18); }
  if (event.key === '-') { event.preventDefault(); releasePointer(); setZoom(zoomTarget / 1.18); }
  if (event.key === '0') { event.preventDefault(); releasePointer(); setZoom(1); }
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); rotationTarget += event.code === 'ArrowLeft' ? -.18 : .18; }
  if (event.code === 'Escape') releasePointer();
});

function frame(now: number) {
  if (disposed) return;
  frameId = requestAnimationFrame(frame);
  const dt = Math.min(.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
  if (document.hidden) return;
  elapsed += dt;
  if (ready) {
    const previousRotation = rotation;
    rotation = THREE.MathUtils.lerp(rotation, rotationTarget, 1 - Math.exp(-dt * 13)); actor.rotation.y = rotation;
    const angularVelocity = dt > .0001 ? (rotation - previousRotation) / dt : 0;
    physics.update(dt, angularVelocity);
    cameraZoom = physics.reducedMotion ? zoomTarget : THREE.MathUtils.lerp(cameraZoom, zoomTarget, 1 - Math.exp(-dt * 12));
    updateCamera();
    const breath = physics.reducedMotion || interaction !== 'idle' ? 0 : Math.sin(elapsed * 1.25) * .004;
    jellyUniforms.uJellySquash.value = physics.squash.value + breath;
    jellyUniforms.uJellySway.value.set(physics.swayX.value + physics.spinSway.value, physics.swayZ.value);
    jellyUniforms.uJellyForce.value.set(...physics.force.map(force => force.value) as [number, number, number]);
    jellyUniforms.uJellyPull.value.set(...physics.pull.map(pull => pull.value) as [number, number, number]);
    jellyUniforms.uJellyAppendages.value.set(physics.leftEar.value, physics.rightEar.value, physics.nose.value);
    jellyUniforms.uBodyDrop.value = physics.support.drop;
    jellyUniforms.uBodyTilt.value.set(...physics.support.tilt);
    jellyUniforms.uFootCompression.value.set(...physics.support.compressions);
    jellyUniforms.uFootLift.value.set(...physics.support.lifts);
    contactShadow.scale.setScalar(1 + physics.squash.value * .045);
    if (shadowNeedsUpdate || (drawCount % 2 === 0 && (physics.energy > .00001 || Math.abs(rotationTarget - rotation) > .0001 || pointerId !== null))) {
      actor.updateMatrixWorld(true); softShadow.render([floor, contactShadow]); shadowNeedsUpdate = false;
    }
    lightTransport?.render(camera,gel);
  }
  renderer.render(scene, camera); drawCount++;
}
function createApi() {
  return {
    poke, reset, setMode,
    inspectTransport: (screenX:number,screenY:number) => lightTransport?.probe(camera,gel,screenX,screenY) ?? null,
    snapshot: () => ({ ready, loadError, mode, interaction, softness: physics.softness, reducedMotion: physics.reducedMotion,
      squash: physics.squash.value, squashVelocity: physics.squash.velocity,
      sway: [physics.swayX.value, physics.swayZ.value], spinSway: physics.spinSway.value, pull: physics.pull.map(pull => pull.value), touchForce: physics.force.map(force => force.value),
      appendages: [physics.leftEar.value, physics.rightEar.value, physics.nose.value], rotation, rotationTarget,
      energy: physics.energy, pointerHeld: pointerId !== null || pinchActive, elapsed, frames: drawCount, meshCount: modelMeshes.length,
      cameraZoom, zoomTarget, zoomBounds: { ...zoomBounds }, pinchActive, touchCount: touchPointers.size,
      support: physics.support.snapshot(),
      earWeights: { ...earWeights },
      appearance: { look_revision: jellyLook.revision, variant: jellyLookVariant, scatteringApproximation: { strength: jellyLook.scatterStrength, color: jellyLook.scatterColor, lightDependent: true, source: lightTransport ? 'two measured rear softbox entry-depth maps' : 'rear softbox', thinRegions: lightTransport ? 'measured light path through deformed geometry' : 'authored ears, nose, foot pads' }, transport: lightTransport?.snapshot() ?? null, materials: [gel, eyes, nostril].map((material, index) => ({ role: ['body-and-ears', 'eyes', 'nostril'][index], color: '#' + material.color.getHexString(), emissive: '#' + material.emissive.getHexString(), emissiveIntensity: material.emissiveIntensity, transmission: material.transmission, opacity: material.opacity, transparent: material.transparent, roughness: material.roughness })) },
      bounds: { height: modelHeight, width: modelWidth, depth: modelDepth }, render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
      modelScreenCenter: (() => { const point = actor.localToWorld(new THREE.Vector3(0, 1.5, .8)).project(camera); return { x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 }; })(),
    }),
  };
}
window.jellyZoo = createApi();
addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true; cancelAnimationFrame(frameId); resources.forEach(resource => resource.dispose()); renderer.dispose();
});
frameId = requestAnimationFrame(frame);
void loadModel();
