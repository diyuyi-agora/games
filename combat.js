/* Shared combat geometry and motion. Also runnable with Node for regression checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Combat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const attacks = {
    light: [
      { duration: .32, contact: .105, active: .085, damage: 12, reach: 157, knock: 19, stop: .04, stun: .23 },
      { duration: .33, contact: .115, active: .085, damage: 14, reach: 166, knock: 22, stop: .05, stun: .25 },
      { duration: .44, contact: .17, active: .10, damage: 21, reach: 180, knock: 35, stop: .065, stun: .34 }
    ],
    heavy: { duration: .79, contact: .35, active: .13, damage: 42, reach: 204, knock: 71, stop: .09, stun: .73 }
  };
  function pose(a, t = a.t) {
    const start = a.kind === 'heavy' ? -1.6 : a.index === 2 ? 1.25 : -1.4;
    const end = a.kind === 'heavy' ? 1.15 : a.index === 2 ? -1.25 : 1.2;
    const wind = a.contact - .065, endTime = a.contact + a.active;
    let angle;
    if (t < wind) angle = start * (.7 + .3 * clamp(t / wind, 0, 1));
    else if (t < a.contact) angle = start * (1 - (t - wind) / .065);
    else if (t < endTime) angle = end * (t - a.contact) / a.active;
    else angle = end + (.52 - end) * clamp((t - endTime) / (a.duration - endTime), 0, 1);
    return { x: 17, y: -80, angle, length: a.reach - 17 };
  }
  function blade(a, x, floor, direction, t = a.t) {
    const p = pose(a, t), base = { x: x + direction * p.x, y: floor + p.y };
    return { base, tip: { x: base.x + direction * Math.cos(p.angle) * p.length, y: base.y + Math.sin(p.angle) * p.length } };
  }
  // Segment versus expanded target box, returning the actual entry position.
  function intersect(from, to, box) {
    let enter = 0, exit = 1;
    for (const axis of ['x', 'y']) {
      const delta = to[axis] - from[axis], min = box[axis + 'Min'], max = box[axis + 'Max'];
      if (Math.abs(delta) < 1e-9) { if (from[axis] < min || from[axis] > max) return null; continue; }
      let a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a); exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return { x: from.x + (to.x - from.x) * enter, y: from.y + (to.y - from.y) * enter };
  }
  function contact(a, before, after, floor, direction, targetBefore, targetAfter) {
    const box = { xMin: -35, xMax: 35, yMin: floor - 151, yMax: floor - 26 };
    // Subsample rotation as well as sweeping its tips; moving targets use relative space.
    const count = Math.max(1, Math.ceil(Math.abs(after.t - before.t) / .004));
    let previous;
    for (let i = 0; i <= count; i++) {
      const f = i / count, x = before.x + (after.x - before.x) * f, t = before.t + (after.t - before.t) * f;
      const target = targetBefore + (targetAfter - targetBefore) * f, b = blade(a, x, floor, direction, t);
      const relative = { base: { x: b.base.x - target, y: b.base.y }, tip: { x: b.tip.x - target, y: b.tip.y } };
      const hit = intersect(relative.base, relative.tip, box) || (previous && intersect(previous.tip, relative.tip, box));
      if (hit) return { x: hit.x + target, y: hit.y };
      previous = relative;
    }
    return null;
  }
  function lunge(a, t) {
    const start = a.contact - .075, end = a.contact + .045;
    return clamp(t - start, 0, end - start) * (a.kind === 'heavy' ? 390 : 270);
  }
  // Exact underdamped spring solution: frequency in rad/s, decay in 1/s.
  function spring(state, dt, frequency = 36, decay = 14) {
    const e = Math.exp(-decay * dt), c = Math.cos(frequency * dt), s = Math.sin(frequency * dt);
    const b = (state.v + decay * state.x) / frequency;
    return { x: e * (state.x * c + b * s), v: e * ((b * frequency - decay * state.x) * c - (state.x * frequency + decay * b) * s) };
  }
  return { attacks, pose, blade, contact, lunge, spring };
});
