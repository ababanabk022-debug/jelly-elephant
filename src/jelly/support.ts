/** Three generalized coordinates supported by four unilateral compliant feet.
 * Coordinates are downward settlement and two small-angle slopes (metres/metre).
 * This is a reduced physical support model, not a volumetric FEM mesh.
 */
export const DEFAULT_SUPPORT_FEET = [[-.53,.55],[.53,.55],[-.53,-1.05],[.53,-1.05]] as const;

export class FourFootSupport {
  mass = 32;
  gravity = 9.81;
  softness = .64;
  reducedMotion = false;
  centers: [number,number][] = DEFAULT_SUPPORT_FEET.map(([x,z])=>[x,z]);
  readonly centerOfMassZ = -.10;
  drop = 0;
  tilt: [number,number] = [0,0];
  verticalVelocity = 0;
  tiltVelocity: [number,number] = [0,0];
  compressions: [number,number,number,number] = [0,0,0,0];
  lifts: [number,number,number,number] = [0,0,0,0];
  footLoads: [number,number,number,number] = [0,0,0,0];
  contact: [boolean,boolean,boolean,boolean] = [false,false,false,false];
  externalLoad = {force:0,x:0,z:-.10};
  constructor(){ this.settle(); }
  setCenters(feet: unknown){
    if(!Array.isArray(feet)||feet.length!==4||!feet.every(foot=>Array.isArray(foot)&&foot.length===2&&foot.every(value=>typeof value==='number'&&Number.isFinite(value))))throw new Error('Expected four finite authored foot centers');
    const centers=feet as [number,number][];
    if(centers[0][0]>=centers[1][0]||centers[2][0]>=centers[3][0]||Math.min(centers[0][1],centers[1][1])<=Math.max(centers[2][1],centers[3][1]))throw new Error('Expected front-left, front-right, rear-left, rear-right foot order');
    this.centers=centers.map(([x,z])=>[x,z]);
    this.reset();
  }
  get weight(){return this.mass*this.gravity;}
  // The authored v25 legs already have a short, broad load-bearing profile.
  // A longer-leg compliance crushed that support by nearly 19 cm at rest.
  // Keep real force integration, with a stiffer short column (k ≈ EA / L).
  get stiffness(){return 1800-750*Math.max(0,Math.min(1,this.softness));}
  private get inertiaX(){return this.mass*.25;}
  private get inertiaZ(){return this.mass*.40;}
  get totalReaction(){return this.footLoads.reduce((a,b)=>a+b,0);}
  get energy(){return .5*this.mass*this.verticalVelocity**2+.5*this.inertiaX*this.tiltVelocity[0]**2+.5*this.inertiaZ*this.tiltVelocity[1]**2;}
  setPressPoint(x:number,z:number){
    // The soft torso transfers a local hand force to its support footprint.
    this.externalLoad.x=Math.max(-.44,Math.min(.44,x));
    this.externalLoad.z=Math.max(-.85,Math.min(.40,z));
  }
  setExternalLoad(forceN:number,x?:number,z?:number){
    if(x!==undefined&&z!==undefined)this.setPressPoint(x,z);
    this.externalLoad.force=Number.isFinite(forceN)?forceN:0;
  }
  applyImpulse(impulseNs:number,x=0,z=this.centerOfMassZ){
    this.verticalVelocity+=impulseNs/this.mass;
    this.tiltVelocity[0]+=impulseNs*x/this.inertiaX;
    this.tiltVelocity[1]+=impulseNs*(z-this.centerOfMassZ)/this.inertiaZ;
  }
  private reactions(){
    const k=this.stiffness;
    const damping=2*(this.reducedMotion?1.05:.62)*Math.sqrt(k*this.mass/4);
    for(let i=0;i<4;i++){
      const [x,z]=this.centers[i],dz=z-this.centerOfMassZ;
      const compression=this.drop+this.tilt[0]*x+this.tilt[1]*dz;
      const velocity=this.verticalVelocity+this.tiltVelocity[0]*x+this.tiltVelocity[1]*dz;
      this.compressions[i]=Math.max(0,compression);
      this.lifts[i]=Math.max(0,-compression);
      this.contact[i]=compression>0;
      this.footLoads[i]=compression>0?Math.max(0,k*compression+damping*velocity):0;
    }
  }
  private integrate(dt:number){
    this.reactions();
    let torqueX=this.externalLoad.force*this.externalLoad.x;
    let torqueZ=this.externalLoad.force*(this.externalLoad.z-this.centerOfMassZ);
    for(let i=0;i<4;i++){
      torqueX-=this.footLoads[i]*this.centers[i][0];
      torqueZ-=this.footLoads[i]*(this.centers[i][1]-this.centerOfMassZ);
    }
    this.verticalVelocity+=(this.weight+this.externalLoad.force-this.totalReaction)/this.mass*dt;
    this.tiltVelocity[0]+=torqueX/this.inertiaX*dt;
    this.tiltVelocity[1]+=torqueZ/this.inertiaZ*dt;
    this.drop+=this.verticalVelocity*dt;
    this.tilt[0]+=this.tiltVelocity[0]*dt;this.tilt[1]+=this.tiltVelocity[1]*dt;
  }
  update(dt:number){
    const duration=Math.min(.10,Math.max(0,dt)),count=Math.max(1,Math.ceil(duration*240));
    for(let i=0;i<count;i++)this.integrate(duration/count);
    this.reactions();
  }
  settle(){
    this.drop=0;this.tilt=[0,0];this.verticalVelocity=0;this.tiltVelocity=[0,0];
    for(let i=0;i<2400;i++)this.integrate(1/240);
    this.reactions();
  }
  reset(){this.externalLoad={force:0,x:0,z:this.centerOfMassZ};this.settle();}
  snapshot(){
    const elastic=this.compressions.reduce((sum,c)=>sum+.5*this.stiffness*c*c,0);
    return {mass:this.mass,gravity:this.gravity,weight:this.weight,stiffness:this.stiffness,footCenters:this.centers.map(foot=>[...foot]),
      totalReaction:this.totalReaction,externalLoad:{...this.externalLoad},drop:this.drop,tilt:[...this.tilt],
      verticalVelocity:this.verticalVelocity,tiltVelocity:[...this.tiltVelocity],footLoads:[...this.footLoads],
      compressions:[...this.compressions],lifts:[...this.lifts],contact:[...this.contact],
      // The unilateral support pads sit at y=0 while loaded; unladen pads lift.
      penetration:this.lifts.map(lift=>Math.max(0,-lift)),maxPenetration:Math.max(0,...this.lifts.map(lift=>-lift)),
      energy:this.energy,totalElasticEnergy:elastic,gravitationalPotential:-this.weight*this.drop,
      totalMechanicalEnergy:this.energy+elastic-this.weight*this.drop,
      netVerticalForce:this.weight+this.externalLoad.force-this.totalReaction};
  }
}
