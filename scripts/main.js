import { KINDS, rollMoment, hpMoment, levelMoment, MomentQueue } from "./detect.js";
import { showSplash } from "./splash.js";

const MODULE_ID = "big-moments";

// Every client sees the same chat messages and document updates, so each one decides for itself
// and shows its own splash. Nothing goes over a socket. Earlier HP and levels are cached here
// because update hooks only carry the new values.
const hpCache = new Map(); // actor uuid -> hp
const levelCache = new Map(); // actor uuid -> character level
const downed = new Set(); // actor uuids seen dropping to 0 this session

const setting = (key) => game.settings.get(MODULE_ID, key);
const enabled = (kind) => setting(`on.${kind}`);

const queue = new MomentQueue((moment) => {
  const src = setting(`sound.${moment.kind}`);
  if (src) foundry.audio.AudioHelper.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
  return showSplash(moment, { duration: setting("duration") * 1000 });
});

const portraitOf = (actor, token) => {
  const img = token?.texture?.src ?? actor?.img;
  return img && !img.includes("mystery-man") ? img : actor?.img ?? "";
};

function announce(kind, actor, { subtitle, token, level } = {}) {
  if (!enabled(kind)) return;
  queue.push({
    kind,
    title: game.i18n.format(`BIGMOMENTS.${kind}.Title`, { name: actor.name, level: level ?? "" }),
    subtitle: subtitle ?? actor.name,
    img: portraitOf(actor, token ?? actor.token),
  });
}

/* -------------------------------------------- */
/*  Natural 20s and 1s                          */
/* -------------------------------------------- */

function readRoll(message) {
  const d20 = message.rolls?.find((r) => r.dice?.some((d) => d.faces === 20));
  if (!d20) return null;
  const actor = message.getAssociatedActor?.() ?? ChatMessage.getSpeakerActor(message.speaker);
  if (!actor) return null;
  const die = d20.dice.find((d) => d.faces === 20);
  const kept = die?.results?.find((r) => r.active)?.result;

  // pf2e: a critical is a degree of success (beating the DC by 10 also counts), known once the roll
  // had a DC. Without one, fall back to the natural 20 or 1.
  const pf2e = message.flags?.pf2e?.context;
  if (pf2e) {
    const outcome = pf2e.outcome;
    return {
      actor,
      roll: {
        type: PF2E_TYPES[pf2e.type] ?? pf2e.type ?? "",
        byPlayer: actor.hasPlayerOwner,
        isCritical: outcome ? outcome === "criticalSuccess" : kept === 20,
        isFumble: outcome ? outcome === "criticalFailure" : kept === 1,
      },
    };
  }

  // dnd5e's D20Roll knows the critical range (a Champion crits on 19); plain rolls fall back to the die.
  return {
    actor,
    roll: {
      type: message.flags?.dnd5e?.roll?.type ?? "",
      byPlayer: actor.hasPlayerOwner,
      isCritical: d20.isCritical ?? kept === 20,
      isFumble: d20.isFumble ?? kept === 1,
    },
  };
}

// pf2e roll types, in dnd5e's terms where rollMoment cares.
const PF2E_TYPES = { "attack-roll": "attack", "spell-attack-roll": "attack", "damage-roll": "damage" };

// With Dice So Nice the result should not be spoiled before the 3D dice stop rolling.
function afterDice(message, fn) {
  if (!game.modules.get("dice-so-nice")?.active || !message.rolls?.length) return fn();
  let done = false;
  const finish = () => { if (!done) { done = true; Hooks.off("diceSoNiceRollComplete", hook); fn(); } };
  const hook = Hooks.on("diceSoNiceRollComplete", (id) => { if (id === message.id) finish(); });
  setTimeout(finish, 8000);
}

function onMessage(message) {
  // Whispers you can't read and blind rolls stay secret. Not `visible`: a whispered roll is
  // "visible" to everyone as a hidden roll, only its content is not.
  if (!message.isContentVisible) return;
  const found = readRoll(message);
  if (!found) return;
  const kind = rollMoment(found.roll, { scope: setting("scope"), monsters: setting("monsters") });
  if (!kind) return;
  const item = message.getAssociatedItem?.();
  const subtitle = item ? `${found.actor.name} · ${item.name}` : found.actor.name;
  afterDice(message, () => announce(kind, found.actor, { subtitle }));
}

/* -------------------------------------------- */
/*  HP and levels                               */
/* -------------------------------------------- */

const hpOf = (actor) => Number(actor.system?.attributes?.hp?.value);
// dnd5e keeps the level as a number, pf2e as { value }.
const levelOf = (actor) => Number(actor.system?.details?.level?.value ?? actor.system?.details?.level);
const isHero = (actor) => actor?.hasPlayerOwner && actor.type === "character";

function remember(actor) {
  if (!isHero(actor)) return;
  hpCache.set(actor.uuid, hpOf(actor));
  levelCache.set(actor.uuid, levelOf(actor));
}

function checkActor(actor) {
  if (!isHero(actor)) return;
  const hp = hpOf(actor);
  const kind = hpMoment(hpCache.get(actor.uuid), hp, downed.has(actor.uuid));
  hpCache.set(actor.uuid, hp);
  if (kind === "down") downed.add(actor.uuid);
  if (kind === "up") downed.delete(actor.uuid);
  if (kind) announce(kind, actor);

  const level = levelOf(actor);
  const reached = levelMoment(levelCache.get(actor.uuid), level);
  levelCache.set(actor.uuid, level);
  if (reached) {
    announce("levelup", actor, {
      level: reached,
      subtitle: game.i18n.format("BIGMOMENTS.levelup.Subtitle", { name: actor.name, level: reached }),
    });
  }
}

/* -------------------------------------------- */
/*  Settings and hooks                          */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
  for (const kind of KINDS) {
    world(`on.${kind}`, { name: `BIGMOMENTS.${kind}.Setting`, type: Boolean, default: true });
  }
  world("scope", {
    name: "BIGMOMENTS.Settings.Scope.Name", hint: "BIGMOMENTS.Settings.Scope.Hint",
    type: String, default: "attacks",
    choices: { attacks: "BIGMOMENTS.Settings.Scope.Attacks", all: "BIGMOMENTS.Settings.Scope.All" },
  });
  world("monsters", {
    name: "BIGMOMENTS.Settings.Monsters.Name", hint: "BIGMOMENTS.Settings.Monsters.Hint",
    type: Boolean, default: false,
  });
  world("duration", {
    name: "BIGMOMENTS.Settings.Duration.Name", hint: "BIGMOMENTS.Settings.Duration.Hint",
    type: Number, default: 2.8, range: { min: 1, max: 8, step: 0.2 },
  });
  const sound = (file) => `modules/${MODULE_ID}/sounds/${file}`;
  const defaultSounds = {
    crit: sound("crit.m4a"),
    fumble: sound("fumble.m4a"),
    levelup: sound("level-up-fanfare.m4a"),
    down: sound("down.m4a"),
    up: sound("up.m4a"),
  };
  for (const kind of KINDS) {
    world(`sound.${kind}`, {
      name: `BIGMOMENTS.${kind}.Sound`, type: String, default: defaultSounds[kind] ?? "", filePicker: "audio",
    });
  }
});

Hooks.once("ready", () => {
  for (const actor of game.actors) remember(actor);
  // Unlinked tokens of player characters are rare but possible.
  for (const token of canvas?.scene?.tokens ?? []) if (!token.actorLink) remember(token.actor);

  Hooks.on("createChatMessage", onMessage);
  Hooks.on("updateActor", checkActor);
  // dnd5e derives the character level from class items, so a level-up arrives as a class update.
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => { if (item.type === "class") checkActor(item.parent); });
  }
  Hooks.on("createActor", remember);
  Hooks.on("canvasReady", () => { for (const t of canvas.scene.tokens) if (!t.actorLink) remember(t.actor); });

  // For macros: game.modules.get("big-moments").api.show("crit", actor) plays one by hand.
  game.modules.get(MODULE_ID).api = {
    show: (kind, actor, options) => KINDS.includes(kind) && actor && announce(kind, actor, options),
  };
});
