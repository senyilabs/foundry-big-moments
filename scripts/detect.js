// Pure decisions about what counts as a big moment. No Foundry globals, so it runs under `node --test`.

export const KINDS = ["crit", "fumble", "levelup", "down", "up"];

// Rolls that never splash: initiative is rolled by everyone at once, damage has no natural 20.
const NEVER = new Set(["initiative", "damage", "healing"]);

// roll: { isCritical, isFumble, type, byPlayer }
// rules: { scope: "attacks" | "all", monsters: boolean }
export function rollMoment(roll, { scope = "attacks", monsters = false } = {}) {
  if (!roll || NEVER.has(roll.type)) return null;
  if (scope === "attacks" && roll.type !== "attack") return null;
  if (!roll.byPlayer && !monsters) return null;
  if (roll.isCritical) return "crit";
  if (roll.isFumble) return "fumble";
  return null;
}

// `wasDown`: we saw this character drop. Without it, 0 -> full is a new character getting its
// HP filled in, not someone getting back up.
export function hpMoment(before, after, wasDown = true) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (before > 0 && after <= 0) return "down";
  if (before <= 0 && after > 0 && wasDown) return "up";
  return null;
}

// A brand-new character (level 0 to 1) is being built, not levelling up.
export function levelMoment(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 1) return null;
  return after > before ? after : null;
}

// Plays splashes one after another so two crits in a row both get their moment.
export class MomentQueue {
  constructor(play, { schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
    this.play = play; // (moment) => duration in ms
    this.schedule = schedule;
    this.items = [];
    this.busy = false;
  }

  push(moment) {
    // A long session can pile up; anything past a handful is stale by the time it would show.
    if (this.items.length >= 4) return;
    this.items.push(moment);
    if (!this.busy) this.next();
  }

  next() {
    const moment = this.items.shift();
    if (!moment) { this.busy = false; return; }
    this.busy = true;
    const ms = this.play(moment);
    this.schedule(() => this.next(), ms);
  }
}
