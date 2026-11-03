import * as THREE from 'three';
import { deformMaterial } from './deform';

/** Underside height shadow: low surfaces dominate, then two soft GPU passes. */
export class ContactShadow {
  readonly plane: THREE.Mesh;
  private camera = new THREE.OrthographicCamera(-3.4, 3.4, 3.4, -3.4, .05, 3.5);
  private raw = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: true });
  private temporary = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false });
  private result = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false });
  private depth = deformMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide }));
  private blurScene = new THREE.Scene();
  private blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blurMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: this.raw.texture }, direction: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D map; uniform vec2 direction; varying vec2 vUv;
      void main(){ vec4 c=texture2D(map,vUv)*.227027;
        c+=(texture2D(map,vUv+direction*1.384615)+texture2D(map,vUv-direction*1.384615))*.316216;
        c+=(texture2D(map,vUv+direction*3.230769)+texture2D(map,vUv-direction*3.230769))*.070270;
        gl_FragColor=c; }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.camera.position.set(0, -.16, -.1); this.camera.up.set(0, 0, 1); this.camera.lookAt(0, 3, -.1);
    const patch = this.depth.onBeforeCompile;
    this.depth.onBeforeCompile = (shader, renderer) => {
      patch(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3(1.0), pow(1.0-clamp(fragCoordZ,0.0,1.0),14.0)*.92 );');
    };
    this.depth.customProgramCacheKey = () => 'jelly-height-shadow-v2';
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.8), new THREE.MeshBasicMaterial({ map: this.result.texture, color: 0x846d61, transparent: true, opacity: .53, depthWrite: false, toneMapped: false }));
    const uv = this.plane.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.plane.rotation.x = -Math.PI / 2; this.plane.position.set(0, -.001, -.1); this.plane.renderOrder = 1;
    scene.add(this.plane); this.blurScene.add(this.quad);
  }
  render(hidden: THREE.Object3D[]) {
    const target = this.renderer.getRenderTarget();
    const background = this.scene.background, override = this.scene.overrideMaterial;
    const clear = this.renderer.getClearColor(new THREE.Color()), alpha = this.renderer.getClearAlpha();
    const visible = hidden.map(object => object.visible);
    hidden.forEach(object => { object.visible = false; }); this.plane.visible = false;
    this.scene.background = null; this.scene.overrideMaterial = this.depth;
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.setRenderTarget(this.raw); this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    this.blurMaterial.uniforms.map.value = this.raw.texture;
    this.blurMaterial.uniforms.direction.value.set(1.7 / 512, 0);
    this.renderer.setRenderTarget(this.temporary); this.renderer.clear(); this.renderer.render(this.blurScene, this.blurCamera);
    this.blurMaterial.uniforms.map.value = this.temporary.texture;
    this.blurMaterial.uniforms.direction.value.set(0, 1.7 / 512);
    this.renderer.setRenderTarget(this.result); this.renderer.clear(); this.renderer.render(this.blurScene, this.blurCamera);
    this.scene.background = background; this.scene.overrideMaterial = override;
    hidden.forEach((object, index) => { object.visible = visible[index]; }); this.plane.visible = true;
    this.renderer.setClearColor(clear, alpha); this.renderer.setRenderTarget(target);
  }
  dispose() {
    this.raw.dispose(); this.temporary.dispose(); this.result.dispose(); this.depth.dispose();
    this.quad.geometry.dispose(); this.blurMaterial.dispose(); this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
  }
}
