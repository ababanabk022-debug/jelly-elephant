import { FourFootSupport } from './support';

export class Spring {
  value = 0;
  velocity = 0;
  target = 0;
  step(dt: number, stiffness: number, damping: number) {
    this.velocity += ((this.target - this.value) * stiffness - this.velocity * damping) * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.value - this.target) < .000005 && Math.abs(this.velocity) < .00005) { this.value = this.target; this.velocity = 0; }
  }
  reset() { this.value = this.velocity = this.target = 0; }
  get energy() { return this.value * this.value + this.velocity * this.velocity * .025; }
}

export class JellyPhysics {
  readonly support = new FourFootSupport();
  softness = .40;
  reducedMotion = false;
  squash = new Spring();
  swayX = new Spring();
  swayZ = new Spring();
  spinSway = new Spring();
  pull = [new Spring(), new Spring(), new Spring()] as const;
  pullHeld = false;
  force = [new Spring(), new Spring(), new Spring()] as const;
  leftEar = new Spring();
  rightEar = new Spring();
  nose = new Spring();
  private all = [this.squash, this.swayX, this.swayZ, this.spinSway, ...this.pull, ...this.force, this.leftEar, this.rightEar, this.nose];
  update(dt: number, angularVelocity = 0) {
    this.support.softness=this.softness;this.support.reducedMotion=this.reducedMotion;
    const handLoad=(this.squash.target*.70+Math.max(0,-this.force[1].target)*.35)*this.support.weight;
    this.support.setExternalLoad(handLoad);
    this.support.update(dt);
    const count = Math.max(1, Math.ceil(Math.min(dt, .05) / (1 / 120)));
    const step = Math.min(dt, .05) / count;
    const stiffness = 120 - this.softness * 77;
    const damping = this.reducedMotion ? 2 * Math.sqrt(stiffness) : 8.5 - this.softness * 3.7;
    for (let i = 0; i < count; i++) {
      this.squash.step(step, stiffness, damping);
      this.swayX.step(step, stiffness * .68, damping * .85);
      this.swayZ.step(step, stiffness * .68, damping * .85);
      // Inertia in the elephant's local frame: its soft upper body briefly
      // lags behind a turn and settles after the turn stops.
      this.spinSway.target = this.reducedMotion ? 0 : Math.max(-.12, Math.min(.12, -angularVelocity * .045));
      this.spinSway.step(step, 46, 8);
      // The hand tracks firmly while dragging. On release the stored stretch
      // drives an underdamped spring: greater stretch produces greater force,
      // fast initial motion, overshoot and several diminishing oscillations.
      for (const pull of this.pull) pull.step(step, 65, this.reducedMotion ? 17 : this.pullHeld ? 14 : 4.0);
      if (this.pull[1].value < -.12) { this.pull[1].value = -.12; this.pull[1].velocity = Math.max(0, this.pull[1].velocity); }
      for (const force of this.force) force.step(step, stiffness * 1.1, damping * 1.05);
      const impulse = this.squash.velocity * .052;
      this.leftEar.target = this.reducedMotion ? 0 : (this.swayX.value + this.spinSway.value) * .28 + impulse;
      this.rightEar.target = this.reducedMotion ? 0 : -(this.swayX.value + this.spinSway.value) * .24 + impulse * .87;
      this.nose.target = this.reducedMotion ? 0 : this.swayZ.value * .14 - this.squash.velocity * .0405;
      this.leftEar.step(step, 40, 4.0);
      this.rightEar.step(step, 32, 3.8);
      this.nose.step(step, 29, 3.5);
      this.leftEar.value = Math.max(-.14, Math.min(.14, this.leftEar.value));
      this.rightEar.value = Math.max(-.14, Math.min(.14, this.rightEar.value));
    }
    this.squash.value = Math.max(-.48, Math.min(.95, this.squash.value));
    for (const spring of [...this.force, this.swayX, this.swayZ]) spring.value = Math.max(-.65, Math.min(.65, spring.value));
  }
  setPressPoint(x:number,z:number){this.support.setPressPoint(x,z);}
  poke() { this.squash.velocity += this.reducedMotion ? 1.25 : 3.4 + this.softness * 1.7; this.swayX.velocity += this.reducedMotion ? 0 : .35; this.support.applyImpulse(this.reducedMotion?3:12); }
  release() { this.pullHeld = false; this.squash.target = this.swayX.target = this.swayZ.target = 0; for (const pull of this.pull) pull.target = 0; for (const force of this.force) force.target = 0;this.support.setExternalLoad(0); }
  reset() { this.pullHeld = false; for (const spring of this.all) spring.reset();this.support.softness=this.softness;this.support.reducedMotion=this.reducedMotion;this.support.reset(); }
  get energy() { return this.all.reduce((sum, spring) => sum + spring.energy, 0)+this.support.energy/this.support.mass; }
}
