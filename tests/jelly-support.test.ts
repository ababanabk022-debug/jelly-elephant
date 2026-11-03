import test from 'node:test';
import assert from 'node:assert/strict';
import { FourFootSupport } from '../src/jelly/support.ts';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => sum(values) / values.length;
const advance = (support: FourFootSupport, seconds: number, dt = 1 / 60) => {
  let time = 0;
  while (time < seconds - 1e-10) { const step = Math.min(dt, seconds - time); support.update(step); time += step; }
  return support.snapshot();
};
const near = (actual: number, expected: number, tolerance: number, message: string) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (tolerance ${tolerance})`);
};

test('four unilateral feet settle to gravity force and moment equilibrium', t => {
  const support = new FourFootSupport();
  const state = advance(support, 8);
  const weight = state.mass * state.gravity;
  assert.equal(state.footLoads.length, 4);
  assert.ok(state.contact.every(Boolean));
  assert.ok(state.compressions.every(value => value > 0));
  near(sum(state.footLoads), weight, weight * .01, 'total upward reaction must balance mg');
  near(sum(state.footLoads), state.totalReaction, .00001, 'reaction diagnostics must agree');
  assert.ok(state.drop > .04 && state.drop < .35, `self weight must cause a plausible nonzero drop, got ${state.drop}`);
  assert.ok(state.footLoads[0] + state.footLoads[1] > state.footLoads[2] + state.footLoads[3], 'COM ahead of foot midpoint should load the front feet more');
  near((state.footLoads[1] + state.footLoads[3] - state.footLoads[0] - state.footLoads[2]) * .53, 0, .5, 'unloaded roll moment');
  near((state.footLoads[0] + state.footLoads[1]) * .65 - (state.footLoads[2] + state.footLoads[3]) * .95, 0, .5, 'unloaded pitch moment about COM z=-.10');
  t.diagnostic(JSON.stringify({ drop: state.drop, weight, reaction: state.totalReaction, footLoads: state.footLoads }));
});

test('mass and compliance change compression instead of imposing a fixed visual offset', () => {
  const light = new FourFootSupport(); light.mass = 24; light.reset();
  const heavy = new FourFootSupport(); heavy.mass = 48; heavy.reset();
  const a = advance(light, 7), b = advance(heavy, 7);
  assert.ok(mean(b.compressions) > mean(a.compressions) * 1.35, 'doubling mass should noticeably increase compression');
  near(b.totalReaction, b.mass * b.gravity, b.mass * b.gravity * .01, 'heavy model force balance');
  const stiff = new FourFootSupport(); stiff.softness = 0; stiff.reset();
  const soft = new FourFootSupport(); soft.softness = 1; soft.reset();
  assert.ok(mean(advance(soft, 7).compressions) > mean(advance(stiff, 7).compressions) * 1.15, 'softer feet should compress more at the same weight');
});

test('authored shorter stance redistributes weight and balances its actual moments', () => {
  const support = new FourFootSupport();
  const originalFrontLoad = support.footLoads[0] + support.footLoads[1];
  support.setCenters([[-.53,.33],[.53,.33],[-.53,-1.05],[.53,-1.05]]);
  const state = advance(support, 6);
  near(state.totalReaction, state.weight, .5, 'authored stance force balance');
  assert.ok(state.footLoads[0] + state.footLoads[1] > originalFrontLoad, 'bringing front feet back must increase their share of the fixed COM weight');
  near(state.footLoads.reduce((moment,force,i)=>moment+force*(state.footCenters[i][1]+.10),0),0,.5,'authored stance pitch balance');
  assert.throws(()=>support.setCenters([[0,0],[0,0],[0,0],[0,0]]),/foot order/);
});

test('off-center added load increases compression and redistributes foot reactions', t => {
  const support = new FourFootSupport();
  const baseline = advance(support, 6);
  support.setExternalLoad(80, .32, .35);
  const loaded = advance(support, 7);
  assert.ok(mean(loaded.compressions) > mean(baseline.compressions) + .01);
  near(loaded.totalReaction, loaded.mass * loaded.gravity + 80, 4, 'reaction with added downward force');
  assert.ok(loaded.footLoads[1] - baseline.footLoads[1] > loaded.footLoads[2] - baseline.footLoads[2], 'front-right pressure must affect that foot more than rear-left');
  assert.ok(Math.abs(loaded.tilt[0] - baseline.tilt[0]) > .005, 'off-center loading should tilt the body');
  near((loaded.footLoads[1] + loaded.footLoads[3] - loaded.footLoads[0] - loaded.footLoads[2]) * .53, 80 * .32, 2, 'roll torque balance under hand load');
  t.diagnostic(JSON.stringify({ baseline: baseline.compressions, loaded: loaded.compressions, tilt: loaded.tilt }));
});

test('removing hand load returns naturally to the original gravity-supported pose', () => {
  const support = new FourFootSupport();
  const baseline = advance(support, 6);
  support.setExternalLoad(100, -.30, .40); advance(support, 2);
  support.setExternalLoad(0);
  const restored = advance(support, 10);
  near(restored.drop, baseline.drop, .0015, 'body drop after unload');
  restored.compressions.forEach((value, i) => near(value, baseline.compressions[i], .002, `foot ${i} after unload`));
  assert.ok(restored.energy < .0001, 'dynamic activity must settle even though elastic self-weight energy remains');
  assert.ok(restored.totalElasticEnergy > .1, 'loaded feet must retain actual elastic energy');
});

test('zero gravity reset has no fabricated self-weight compression or reaction', () => {
  const support = new FourFootSupport(); support.gravity = 0; support.reset();
  const state = advance(support, 4);
  near(state.totalReaction, 0, .0001, 'zero-g reaction');
  state.compressions.forEach(value => near(value, 0, .00001, 'zero-g compression'));
  near(state.drop, 0, .0001, 'zero-g neutral pose');
});

test('support integration remains stable across normal frame-step sizes', () => {
  const states = [1 / 30, 1 / 60, 1 / 144].map(dt => {
    const support = new FourFootSupport();
    support.setExternalLoad(90, .25, .35);
    const loadedTransient = advance(support, .18, dt);
    support.setExternalLoad(0);
    const releasedTransient = advance(support, .16, dt);
    const settled = advance(support, 4, dt);
    return [loadedTransient, releasedTransient, settled];
  });
  for (const samples of states.slice(1)) {
    samples.forEach((state, sampleIndex) => {
      near(state.drop, states[0][sampleIndex].drop, .003, 'frame-step-sensitive transient or settled drop');
      state.tilt.forEach((value, i) => near(value, states[0][sampleIndex].tilt[i], .003, 'frame-step-sensitive tilt'));
      state.compressions.forEach(value => assert.ok(Number.isFinite(value) && value >= 0));
    });
  }
});

test('unloading permits lift while reactions stay unilateral and support plane constraints hold', () => {
  const support = new FourFootSupport();
  support.setExternalLoad(-support.mass * support.gravity * 1.2, 0, -.10);
  let sawLift = false;
  for (let i = 0; i < 120; i++) {
    support.update(1 / 120); const state = support.snapshot();
    assert.ok(state.footLoads.every(force => Number.isFinite(force) && force >= 0), 'unilateral contacts cannot exert tension');
    assert.ok(state.lifts.every(height => height >= 0), 'foot sole height cannot be below the contact plane');
    // This checks the reduced support model, not mesh collision detection.
    // Rendered vertices are separately projected above y=0 in deform.ts.
    assert.ok(state.maxPenetration <= 1e-8, 'support constraint penetrated the ground');
    sawLift ||= state.lifts.some(height => height > .001);
  }
  assert.ok(sawLift, 'upward force greater than weight should be able to unload/lift the feet');
  support.setExternalLoad(0);
  for (let i = 0; i < 1200; i++) {
    support.update(1 / 120); const state = support.snapshot();
    assert.ok(state.maxPenetration <= 1e-8 && Number.isFinite(state.drop), 'landing must remain finite and nonpenetrating');
  }
});
