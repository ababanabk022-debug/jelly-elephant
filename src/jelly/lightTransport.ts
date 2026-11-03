import * as THREE from 'three';
import { deformMaterial } from './deform';
import { jellyLook } from './look';

/** First-surface light-space transport. Empty gaps are not depth-peeled. */
export class JellyLightTransport {
  private readonly passMaterials = new Map<THREE.MeshPhysicalMaterial, THREE.MeshPhysicalMaterial>();
  private readonly resolution = 768;
  private readonly range = 16;
  private depth = deformMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.FrontSide }));
  private sources: Array<{ camera: THREE.OrthographicCamera; target: THREE.WebGLRenderTarget; matrix: THREE.Matrix4; direction: THREE.Vector3; color: THREE.Color }> = [];
  readonly uniforms: Record<string, THREE.IUniform> = {};
  private renders = 0;
  private screenSize = new THREE.Vector2();
  private diffuseRaw = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  private diffuseTemporary = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private diffuseResult = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private blurScene = new THREE.Scene();
  private blurCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  private blurMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: this.diffuseRaw.texture }, direction: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform sampler2D map; uniform vec2 direction;
      void main(){ vec4 center=texture2D(map,vUv); if(center.a<=0.0){gl_FragColor=vec4(0.0);return;}
        vec3 sum=vec3(0.0);float weight=0.0;
        for(int i=-8;i<=8;i++){float offset=float(i)*.25;float baseWeight=exp(-float(i*i)/32.0);
          vec4 sampleValue=texture2D(map,vUv+direction*offset);
          float w=baseWeight*exp(-abs(center.a-sampleValue.a)*3.0)*step(.001,sampleValue.a);
          sum+=sampleValue.rgb*w;weight+=w;}
        gl_FragColor=vec4(sum/max(weight,.001),center.a);
      }`, depthTest:false,depthWrite:false,toneMapped:false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.blurMaterial);
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    const beforeDepth = this.depth.onBeforeCompile;
    this.depth.onBeforeCompile = (shader, renderer) => {
      beforeDepth(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = packDepthToRGBA( fragCoordZ );', 'gl_FragColor = vec4(fragCoordZ, 0.0, 0.0, 1.0);');
    };
    this.depth.customProgramCacheKey = () => 'jelly-transport-linear-depth-v1';
    const center = new THREE.Vector3(0, 1.25, 0);
    const bias = new THREE.Matrix4().set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1);
    for (let i = 0; i < 2; i++) {
      const panel = jellyLook.panels[i + 2];
      const direction = new THREE.Vector3().fromArray(panel.position).sub(center).normalize();
      const camera = new THREE.OrthographicCamera(-3.5, 3.5, 3.5, -3.5, .05, .05 + this.range);
      camera.position.copy(center).addScaledVector(direction, 8); camera.lookAt(center); camera.layers.set(1); camera.updateMatrixWorld(true);
      const target = new THREE.WebGLRenderTarget(this.resolution, this.resolution, { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
      target.texture.generateMipmaps = false;
      const matrix = bias.clone().multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
      const referenceArea = i === 0 ? 24.36 : 15.2;
      const areaFactor = panel.size[0] * panel.size[1] / referenceArea;
      // The side source remains available to the subsurface pass, while its
      // reflection card is dimmed to avoid a second hard white highlight.
      const transportColor = ('transportColor' in panel && panel.transportColor) || panel.color;
      const color = new THREE.Color().fromArray(transportColor).multiplyScalar(.17 * areaFactor);
      this.sources.push({ camera, target, matrix, direction, color });
      this.uniforms['uTransportDepth' + i] = { value: target.texture };
      this.uniforms['uTransportMatrix' + i] = { value: matrix };
      this.uniforms['uTransportDirection' + i] = { value: direction };
      this.uniforms['uTransportColor' + i] = { value: color };
    }
    this.uniforms.uTransportRange = { value: this.range };
    this.uniforms.uTransportTexel = { value: 1 / this.resolution };
    this.uniforms.uTransportStrength = { value: jellyLook.scatterStrength };
    this.uniforms.uTransportPass = { value: 0 };
    this.uniforms.uTransportScreen = { value: this.diffuseResult.texture };
    this.uniforms.uTransportScreenSize = { value: this.screenSize };
    this.blurScene.add(this.quad);
  }
  apply<T extends THREE.MeshPhysicalMaterial>(material: T): T {
    const before = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer); Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTransportWorld;');
      shader.vertexShader = shader.vertexShader.replace('vec3 transformed = jellyDeform(position);', 'vec3 transformed = jellyDeform(position);\nvTransportWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <packing>', `#include <packing>
        varying vec3 vTransportWorld;
        uniform sampler2D uTransportDepth0;
        uniform sampler2D uTransportDepth1;
        uniform mat4 uTransportMatrix0;
        uniform mat4 uTransportMatrix1;
        uniform vec3 uTransportDirection0;
        uniform vec3 uTransportDirection1;
        uniform vec3 uTransportColor0;
        uniform vec3 uTransportColor1;
        uniform float uTransportRange;
        uniform float uTransportTexel;
        uniform float uTransportStrength;
        uniform float uTransportPass;
        uniform sampler2D uTransportScreen;
        uniform vec2 uTransportScreenSize;
        vec3 gelPathProfile(sampler2D depthMap, vec3 projected, vec2 offset) {
          float entry = texture2D(depthMap, projected.xy + offset * uTransportTexel).r;
          float pathLength = max((projected.z - entry) * uTransportRange - .018, 0.0);
          // Wavelength-dependent extinction in model metres. This is light
          // emerging after travel through material, never a background lookup.
          vec3 attenuation = exp(-pathLength * vec3(3.0, 3.4, 4.6));
          float emergence = smoothstep(.018,.065,pathLength) * (1.0 - exp(-pathLength * 28.0));
          return attenuation * emergence * step(entry, .9999);
        }
        vec3 gelTransport(sampler2D depthMap, mat4 lightMatrix, vec3 lightDirection, vec3 lightColor, vec3 surfaceNormal, vec3 viewDirection) {
          vec3 projected = (lightMatrix * vec4(vTransportWorld, 1.0)).xyz;
          float inside = step(0.0, projected.x)*step(projected.x,1.0)*step(0.0,projected.y)*step(projected.y,1.0);
          vec3 through = gelPathProfile(depthMap,projected,vec2(0.0));
          through += gelPathProfile(depthMap,projected,vec2(-4.0,-2.0));
          through += gelPathProfile(depthMap,projected,vec2(2.0,-4.0));
          through += gelPathProfile(depthMap,projected,vec2(4.0,2.0));
          through += gelPathProfile(depthMap,projected,vec2(-2.0,4.0));
          through += gelPathProfile(depthMap,projected,vec2(-6.5,2.7));
          through += gelPathProfile(depthMap,projected,vec2(-2.7,-6.5));
          through += gelPathProfile(depthMap,projected,vec2(6.5,-2.7));
          through += gelPathProfile(depthMap,projected,vec2(2.7,6.5));
          through *= 1.0/9.0;
          vec3 incoming = normalize((viewMatrix*vec4(lightDirection,0.0)).xyz);
          float backFacing = 1.0-smoothstep(-.25,.05,dot(surfaceNormal,incoming));
          float phase = .40 + .60*pow(max(dot(viewDirection,-incoming),0.0),2.0);
          return through * lightColor * backFacing * phase * inside;
        }
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if(uTransportPass>.5){
          if(uTransportPass>3.5){gl_FragColor=vec4(texture2D(uTransportScreen,gl_FragCoord.xy/uTransportScreenSize).rgb,1.0);return;}
          if(uTransportPass>2.5){gl_FragColor=vec4(normal,1.0);return;}
          if(uTransportPass>1.5){gl_FragColor=vec4(vTransportWorld,1.0);return;}
          vec3 passTransport = gelTransport(uTransportDepth0,uTransportMatrix0,uTransportDirection0,uTransportColor0,normal,geometryViewDir);
          passTransport += gelTransport(uTransportDepth1,uTransportMatrix1,uTransportDirection1,uTransportColor1,normal,geometryViewDir);
          ${material.userData.jellyCavity ? 'passTransport *= 1.0-.94*smoothstep(.01,.10,vCavityDepth);' : ''}
          vec3 convertedTransport = vec3(1.0)-exp(-passTransport*uTransportStrength);
          vec3 diffuseRadiance = reflectedLight.indirectDiffuse*.62 + sqrt(material.diffuseColor)*convertedTransport*.85;
          gl_FragColor=vec4(diffuseRadiance,vViewPosition.z);return;
        }
        vec3 diffusedRadiance = texture2D(uTransportScreen,gl_FragCoord.xy/uTransportScreenSize).rgb;
        ${material.userData.jellyCavity ? 'diffusedRadiance *= 1.0-.88*smoothstep(.015,.12,vCavityDepth);' : ''}
        // Redistribute the existing diffuse energy; keep specular unblurred.
        reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse*.38 + diffusedRadiance;
      `);
    };
    material.customProgramCacheKey = () => key + '-light-space-transport-v1';
    return material;
  }
  render(camera:THREE.PerspectiveCamera,material:THREE.MeshPhysicalMaterial) {
    const target = this.renderer.getRenderTarget(), background = this.scene.background, override = this.scene.overrideMaterial;
    const clear = this.renderer.getClearColor(new THREE.Color()), alpha = this.renderer.getClearAlpha();
    this.scene.background = null; this.scene.overrideMaterial = this.depth; this.renderer.setClearColor(0xffffff, 1);
    for (const source of this.sources) { this.renderer.setRenderTarget(source.target); this.renderer.clear(); this.renderer.render(this.scene, source.camera); }
    this.renderer.getDrawingBufferSize(this.screenSize);
    const width=Math.ceil(this.screenSize.x*.5),height=Math.ceil(this.screenSize.y*.5);
    if(this.diffuseRaw.width!==width||this.diffuseRaw.height!==height){this.diffuseRaw.setSize(width,height);this.diffuseTemporary.setSize(width,height);this.diffuseResult.setSize(width,height);}
    const cameraMask=camera.layers.mask; camera.layers.set(1); this.scene.overrideMaterial=null;
    // Never alpha-blend the light buffer: its alpha stores view depth for
    // the diffusion filter. Use opaque copies for the offscreen pass.
    const replacements: Array<{mesh:THREE.Mesh; original:THREE.MeshPhysicalMaterial}> = [];
    this.scene.traverse(object => {
      const mesh=object as THREE.Mesh, original=mesh.material;
      if (!mesh.isMesh || !(original instanceof THREE.MeshPhysicalMaterial) || (!original.transparent && original.transmission<=0) || !mesh.layers.test(camera.layers)) return;
      let pass=this.passMaterials.get(original);
      if(!pass){pass=original.clone();pass.transmission=0;pass.transparent=false;pass.opacity=1;pass.depthWrite=true;pass.onBeforeCompile=original.onBeforeCompile;pass.customProgramCacheKey=original.customProgramCacheKey;this.passMaterials.set(original,pass);}
      pass.color.copy(original.color);pass.roughness=original.roughness;
      replacements.push({mesh,original});mesh.material=pass;
    });
    this.uniforms.uTransportPass.value=1;this.renderer.setClearColor(0,0);this.renderer.setRenderTarget(this.diffuseRaw);this.renderer.clear();
    try { this.renderer.render(this.scene,camera); }
    finally { replacements.forEach(({mesh,original})=>{mesh.material=original;});this.uniforms.uTransportPass.value=0;camera.layers.mask=cameraMask; }
    const distance=camera.position.distanceTo(new THREE.Vector3(0,1.25,0));
    const radiusPixels=.10*height/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*distance);
    this.blurMaterial.uniforms.map.value=this.diffuseRaw.texture;this.blurMaterial.uniforms.direction.value.set(radiusPixels/width,0);
    this.renderer.setRenderTarget(this.diffuseTemporary);this.renderer.clear();this.renderer.render(this.blurScene,this.blurCamera);
    this.blurMaterial.uniforms.map.value=this.diffuseTemporary.texture;this.blurMaterial.uniforms.direction.value.set(0,radiusPixels/height);
    this.renderer.setRenderTarget(this.diffuseResult);this.renderer.clear();this.renderer.render(this.blurScene,this.blurCamera);
    this.renderer.setRenderTarget(target); this.renderer.setClearColor(clear, alpha); this.scene.background = background; this.scene.overrideMaterial = override; this.renders++;
  }
  snapshot() { return { effectiveScatterStrength: this.uniforms.uTransportStrength.value, method: 'two light-space entry-depth maps; spectral attenuation; depth-aware diffusion of surface irradiance and bounded transport', resolution: this.resolution, sources: 2, diffusionWorldRadius: .10, diffusionTapsPerAxis: 17, diffuseRedistribution: .62, diffuseConversion: 'bounded 1-exp(-radiance*strength)', updatedFrames: this.renders, limitation: 'first entry depth; empty spaces are not depth-peeled', extinctionPerMetre: [3.0, 3.4, 4.6] }; }
  setVisualOpacity(opacity: number) {
    // A more opaque jelly scatters less of the rear light through its volume.
    // Interpolate continuously so 99% and 100% do not abruptly change look.
    const opaque = THREE.MathUtils.smoothstep(opacity, .20, 1);
    this.uniforms.uTransportStrength.value = THREE.MathUtils.lerp(jellyLook.scatterStrength, 2.4, opaque);
  }
  /** Read-only debug probe: actual GPU-deformed position and light entry depths. */
  probe(camera:THREE.PerspectiveCamera,material:THREE.MeshPhysicalMaterial,x:number,y:number){
    const target=this.renderer.getRenderTarget(),background=this.scene.background,override=this.scene.overrideMaterial;
    const clear=this.renderer.getClearColor(new THREE.Color()),alpha=this.renderer.getClearAlpha(),mask=camera.layers.mask;
    const size=this.renderer.getSize(new THREE.Vector2());
    const probeTarget=new THREE.WebGLRenderTarget(size.x,size.y,{type:THREE.FloatType,depthBuffer:true});
    const px=Math.max(0,Math.min(size.x-1,Math.floor(x))),py=Math.max(0,Math.min(size.y-1,Math.floor(size.y-y)));
    const position=new Float32Array(4),normal=new Float32Array(4),transport=new Float32Array(4);
    this.scene.background=null;this.scene.overrideMaterial=material;camera.layers.set(1);this.renderer.setClearColor(0,0);this.renderer.setRenderTarget(probeTarget);
    for(const [mode,data] of [[2,position],[3,normal],[4,transport]] as const){this.uniforms.uTransportPass.value=mode;this.renderer.clear();this.renderer.render(this.scene,camera);this.renderer.readRenderTargetPixels(probeTarget,px,py,1,1,data);}
    this.uniforms.uTransportPass.value=0;camera.layers.mask=mask;this.scene.background=background;this.scene.overrideMaterial=override;this.renderer.setRenderTarget(target);this.renderer.setClearColor(clear,alpha);probeTarget.dispose();
    if(position[3]===0)return null;
    const point=new THREE.Vector3().fromArray(position),n=new THREE.Vector3().fromArray(normal);
    return {position:point.toArray(),normal:n.toArray(),diffusedRadiance:Array.from(transport),sources:this.sources.map(source=>{const projected=point.clone().applyMatrix4(source.matrix);const buffer=new Float32Array(4);this.renderer.readRenderTargetPixels(source.target,Math.min(this.resolution-1,Math.max(0,Math.floor(projected.x*this.resolution))),Math.min(this.resolution-1,Math.max(0,Math.floor(projected.y*this.resolution))),1,1,buffer);return {entry:buffer[0],projected:projected.toArray(),path:Math.max((projected.z-buffer[0])*this.range-.018,0),normalDot:n.dot(source.direction.clone().transformDirection(camera.matrixWorldInverse))};})};
  }
  dispose() { this.depth.dispose(); this.passMaterials.forEach(material=>material.dispose());this.sources.forEach(source => source.target.dispose());this.diffuseRaw.dispose();this.diffuseTemporary.dispose();this.diffuseResult.dispose();this.quad.geometry.dispose();this.blurMaterial.dispose(); }
}
