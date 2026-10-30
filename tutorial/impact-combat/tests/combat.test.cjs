const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Combat = require('../combat.js');

// Run the actual game loop with controlled display timestamps and lightweight DOM.
// This verifies game behavior across frame rates without depending on browser speed.
function game() {
  class Element {
    constructor() { this.listeners = {}; this.style = { setProperty() {} }; this.children = []; this.value = ''; this.hidden = true; this.checked = true; this.classList = { add() {}, remove() {}, toggle() {} }; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute() {}
    click() { this.listeners.click?.({ target: this }); }
    scrollIntoView() {}
    focus() {}
    getBoundingClientRect() { return { width: 1200, height: 680 }; }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  el('target-type').value = 'standard';
  el('player-health').children = Array.from({ length: 5 }, () => new Element());
  const ctx = new Proxy({}, { get(_, key) { return key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}; }, set() { return true; } });
  el('game').getContext = () => ctx;
  const document = { hidden: false, getElementById: el, querySelector: el, querySelectorAll: () => [], addEventListener() {} };
  const window = new Element(); let callback, now = 0;
  const context = { Combat, window, document, location: { search: '?debug=1' }, URLSearchParams, structuredClone, matchMedia: () => ({ matches: false }), devicePixelRatio: 1, requestAnimationFrame: fn => { callback = fn; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8'), context);
  callback(now);
  function tick(ms) { now += ms; callback(now); }
  function run(ms, fps = 60) { let left = ms; while (left > 1e-7) { const dt = Math.min(1000 / fps, left); tick(dt); left -= dt; } }
  const down = key => window.listeners.keydown({ key, target: { tagName: 'CANVAS' }, preventDefault() {} });
  const up = key => window.listeners.keyup({ key });
  function press(key) { down(key); up(key); }
  return { el, tick, run, press, down, up, state: () => window.impactLab.snapshot(), document };
}

test('sword sweep mirrors direction and rejects targets outside its visible reach', () => {
  const a = { kind: 'heavy', index: 0, ...Combat.attacks.heavy };
  const before = { x: 500, t: a.contact }, after = { x: 500, t: a.contact + .01 };
  const right = Combat.contact(a, before, after, 514, 1, 700, 700);
  const left = Combat.contact(a, before, after, 514, -1, 300, 300);
  assert.ok(right && left); assert.ok(Math.abs(right.x + left.x - 1000) < 1e-8);
  assert.equal(Combat.contact(a, before, after, 514, 1, 800, 800), null);
  assert.equal(Combat.contact(a, before, after, 514, 1, 300, 300), null);
});

test('spring returns the same pose regardless of update subdivision', () => {
  let state = { x: 0, v: 350 };
  const whole = Combat.spring(state, .2);
  for (let i = 0; i < 48; i++) state = Combat.spring(state, 1 / 240);
  assert.ok(Math.abs(whole.x - state.x) < 1e-9);
  assert.ok(Math.abs(whole.v - state.v) < 1e-9);
});

test('same heavy hit at 20, 30, 60 and 144 fps; one hit per swing', () => {
  const positions = [];
  for (const fps of [20, 30, 60, 144]) {
    const g = game(); g.press('k'); g.run(1000, fps);
    const s = g.state();
    assert.equal(s.totalHits, 1, `hits at ${fps} fps`);
    assert.equal(s.enemy.hp, 138);
    assert.equal(s.events.find(e => e.type === 'contact').stop, 90);
    assert.ok(s.events.some(e => e.type === 'stop-end'));
    positions.push(s.enemy.x);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < .3);
});

test('raw and full feedback preserve damage and geometry', () => {
  const full = game(); full.press('k'); full.run(1000);
  const raw = game(); raw.el('preset-raw').click(); raw.press('k'); raw.run(1000);
  assert.equal(full.state().enemy.hp, raw.state().enemy.hp);
  assert.equal(full.state().lastContact.x, raw.state().lastContact.x);
  assert.equal(raw.state().events.find(e => e.type === 'contact').stop, 0);
});

test('early next input survives heavy recovery and dodge cannot be overwritten by mashing', () => {
  const g = game(); g.press('k'); g.run(50); g.press('j'); g.run(1000);
  assert.ok(g.state().events.filter(e => e.type === 'attack').length >= 2);
  const d = game(); d.press('k'); d.run(50); d.press(' '); d.press('j'); d.run(700);
  assert.ok(d.state().events.some(e => e.type === 'dash'));
  assert.equal(d.state().events.filter(e => e.type === 'attack').length, 1);
});

test('queued three-hit combo reaches third strike', () => {
  const g = game(); g.press('j'); g.run(50); g.press('j'); g.run(240); g.press('j'); g.run(650);
  const attacks = g.state().events.filter(e => e.type === 'attack');
  assert.deepEqual(Array.from(attacks, a => a.index), [1, 2, 3]);
  assert.equal(g.state().totalHits, 3);
});

test('three heavy strikes break armor, contact stays at the pre-push location', () => {
  const g = game(); g.el('target-type').value = 'armor'; g.el('target-type').listeners.change();
  for (let i = 0; i < 3; i++) { g.press('k'); g.run(1000); }
  assert.equal(g.state().enemy.armor, 0);
  const hit = g.state().events.find(e => e.type === 'contact');
  assert.ok(Math.abs(hit.x - hit.targetX) <= 35.0001);
});

test('trial is 30 seconds at 20 fps, and still expires after a long render stall', () => {
  const g = game(); g.el('challenge-button').click();
  for (let i = 0; i < 10; i++) { const key = i % 2 ? 'a' : 'd'; g.down(key); g.run(2000, 20); g.up(key); }
  assert.ok(Math.abs(g.state().remaining - 10) < .001);
  for (let i = 0; i < 5; i++) { const key = i % 2 ? 'a' : 'd'; g.down(key); g.run(2000, 20); g.up(key); }
  assert.equal(g.state().remaining, 0); assert.equal(g.state().finished, true);
  const stalled = game(); stalled.el('challenge-button').click(); stalled.tick(31000);
  assert.equal(stalled.state().finished, true); assert.equal(stalled.state().remaining, 0);
});
