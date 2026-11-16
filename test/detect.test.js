import { test } from "node:test";
import assert from "node:assert/strict";
import { rollMoment, hpMoment, levelMoment, MomentQueue } from "../scripts/detect.js";

const attack = (over) => ({ type: "attack", byPlayer: true, isCritical: false, isFumble: false, ...over });

test("a player's natural 20 or 1 on an attack is a moment", () => {
  assert.equal(rollMoment(attack({ isCritical: true })), "crit");
  assert.equal(rollMoment(attack({ isFumble: true })), "fumble");
  assert.equal(rollMoment(attack()), null);
});

test("by default only attacks count; 'all' adds other d20 rolls but never initiative", () => {
  const save = attack({ type: "save", isCritical: true });
  assert.equal(rollMoment(save), null);
  assert.equal(rollMoment(save, { scope: "all" }), "crit");
  assert.equal(rollMoment(attack({ type: "initiative", isCritical: true }), { scope: "all" }), null);
});

test("monster rolls only count when switched on", () => {
  const monster = attack({ byPlayer: false, isCritical: true });
  assert.equal(rollMoment(monster), null);
  assert.equal(rollMoment(monster, { monsters: true }), "crit");
});

test("dropping to 0 and getting back up, nothing else", () => {
  assert.equal(hpMoment(5, 0), "down");
  assert.equal(hpMoment(5, -3), "down");
  assert.equal(hpMoment(0, 1), "up");
  assert.equal(hpMoment(10, 4), null);
  assert.equal(hpMoment(0, 0), null);
  assert.equal(hpMoment(undefined, 0), null);
  // A fresh character going from 0 to full was never down.
  assert.equal(hpMoment(0, 30, false), null);
});

test("a level-up needs an existing character going up", () => {
  assert.equal(levelMoment(4, 5), 5);
  assert.equal(levelMoment(4, 6), 6);
  assert.equal(levelMoment(0, 1), null);
  assert.equal(levelMoment(5, 4), null);
  assert.equal(levelMoment(undefined, 3), null);
});

test("moments play one after another, and a backlog is capped", () => {
  const played = [];
  let pending = null;
  const q = new MomentQueue((m) => { played.push(m); return 100; }, { schedule: (fn) => (pending = fn) });
  for (const n of [1, 2, 3, 4, 5, 6]) q.push(n);
  assert.deepEqual(played, [1]);
  pending();
  pending();
  assert.deepEqual(played, [1, 2, 3]);
  pending(); pending(); pending();
  assert.deepEqual(played, [1, 2, 3, 4, 5]);
  assert.equal(q.busy, false);
});
