import { chromium } from "playwright-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const errs = [];
async function login(name) {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on("pageerror", (e) => errs.push(`${name} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(`${name} console: ${m.text().slice(0, 300)}`); });
  let id;
  for (let i = 0; i < 10 && !id; i++) {
    await p.goto("http://localhost:30000/join", { waitUntil: "networkidle" });
    id = await p.evaluate((n) => [...document.querySelectorAll("select[name=userId] option")].find((o) => o.textContent.trim() === n && !o.disabled)?.value, name);
    if (!id) await sleep(2000);
  }
  if (!id) throw new Error(`no free ${name} user on the join page`);
  await p.selectOption("select[name=userId]", id);
  await p.click("button[name=join]");
  await p.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60000 });
  return p;
}
let gm = await login("Tester");
if (!(await gm.evaluate(() => game.modules.get("big-moments")?.active))) {
  await gm.evaluate(async () => {
    const config = game.settings.get("core", "moduleConfiguration");
    await game.settings.set("core", "moduleConfiguration", { ...config, "big-moments": true });
  });
}
await gm.evaluate(() => game.socket.emit("reload"));
await sleep(1500);
await gm.close();
gm = await login("Tester");
const player = await login("Player A");
await sleep(3000);
console.log("active:", await gm.evaluate(() => game.modules.get("big-moments")?.active));

// Watch the player's screen for splashes.
await player.evaluate(() => {
  window.__splashes = [];
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.classList?.contains("big-moment")) window.__splashes.push(`${[...n.classList].join(" ")} | ${n.innerText.replace(/\s+/g, " ")}`);
    }
  }).observe(document.body, { childList: true });
});

const hero = await gm.evaluate(async () => {
  for (const a of game.actors.filter((a) => a.getFlag("world", "bmTest"))) await a.delete();
  const player = game.users.getName("Player A");
  const hero = await Actor.create({ name: "Brenna Ashford", type: "character", img: "icons/svg/mystery-man.svg",
    ownership: { default: 0, [player.id]: 3 }, flags: { world: { bmTest: true } } });
  const pack = game.packs.get("dnd5e.classes");
  const idx = await pack.getIndex();
  const fighter = (await pack.getDocument(idx.find((e) => e.name === "Fighter")._id)).toObject();
  fighter.system.levels = 4;
  await hero.createEmbeddedDocuments("Item", [fighter]);
  await hero.update({ "system.attributes.hp.max": 40 });
  await hero.update({ "system.attributes.hp.value": 30 });
  return { uuid: hero.uuid, level: hero.system.details.level, hp: hero.system.attributes.hp.value };
});
console.log("hero:", JSON.stringify(hero));
await sleep(2000);

const steps = {
  "nat 20 attack": async (uuid) => {
    const hero = await fromUuid(uuid);
    let roll;
    let n = 0; do { roll = await new CONFIG.Dice.D20Roll("1d20 + 5", {}, { criticalSuccess: 20, criticalFailure: 1 }).evaluate(); } while (!roll.isCritical && ++n < 400);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: hero }), flags: { dnd5e: { roll: { type: "attack" } } } });
  },
  "nat 1 attack": async (uuid) => {
    const hero = await fromUuid(uuid);
    let roll;
    let n = 0; do { roll = await new CONFIG.Dice.D20Roll("1d20 + 5", {}, { criticalSuccess: 20, criticalFailure: 1 }).evaluate(); } while (!roll.isFumble && ++n < 400);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: hero }), flags: { dnd5e: { roll: { type: "attack" } } } });
  },
  "nat 20 save (should not show)": async (uuid) => {
    const hero = await fromUuid(uuid);
    let roll;
    let n = 0; do { roll = await new CONFIG.Dice.D20Roll("1d20", {}, { criticalSuccess: 20, criticalFailure: 1 }).evaluate(); } while (!roll.isCritical && ++n < 400);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: hero }), flags: { dnd5e: { roll: { type: "save" } } } });
  },
  "whispered GM nat 20 (should not show)": async (uuid) => {
    const hero = await fromUuid(uuid);
    let roll;
    let n = 0; do { roll = await new CONFIG.Dice.D20Roll("1d20", {}, { criticalSuccess: 20, criticalFailure: 1 }).evaluate(); } while (!roll.isCritical && ++n < 400);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: hero }), flags: { dnd5e: { roll: { type: "attack" } } } }, { rollMode: "gmroll" });
  },
  "blind nat 20 (should not show)": async (uuid) => {
    const hero = await fromUuid(uuid);
    let roll, n = 0;
    do { roll = await new CONFIG.Dice.D20Roll("1d20", {}, { criticalSuccess: 20, criticalFailure: 1 }).evaluate(); } while (!roll.isCritical && ++n < 400);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: hero }), flags: { dnd5e: { roll: { type: "attack" } } } }, { messageMode: "blind" });
  },
  "level 4 -> 5": async (uuid) => {
    const hero = await fromUuid(uuid);
    await hero.items.find((i) => i.type === "class").update({ "system.levels": 5 });
  },
  "drops to 0": async (uuid) => { await (await fromUuid(uuid)).update({ "system.attributes.hp.value": 0 }); },
  "back up": async (uuid) => { await (await fromUuid(uuid)).update({ "system.attributes.hp.value": 7 }); },
};
for (const [name, fn] of Object.entries(steps)) {
  await gm.evaluate(fn, hero.uuid);
  await sleep(name === "level 4 -> 5" ? 1200 : 400);
  if (name === "nat 20 attack") await player.screenshot({ path: "moment-crit.png" });
  if (name === "level 4 -> 5") await player.screenshot({ path: "moment-level.png" });
  await sleep(3200);
  console.log(name.padEnd(40), "->", await player.evaluate(() => window.__splashes.splice(0).join(" || ") || "(nothing)"));
}
console.log(errs.join("\n"));
await b.close();
