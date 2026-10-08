// MTG Deck Builder — version mobile autonome (PWA). Tout tourne dans le navigateur.
import * as B from "./builder.js";
import * as S from "./store.js";
import * as SF from "./scryfall.js";
import { I18N } from "./i18n.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ------------------------------------------------------------------ état
let lang = "fr";
try { lang = localStorage.getItem("lang") || "fr"; } catch { /* stockage indisponible */ }
const t = k => I18N[lang][k];
let collection = [], res = {}, cmdList = [], deck = null, pool = [];
let currentDeckId = null, currentDeckName = "", lastBody = null, lastSuggestion = null, groupBy = "role";

// affichage des cartes dans la langue choisie
const fr = c => (lang === "fr" && c?.fr ? c.fr : null);
const cName = c => fr(c)?.name || (lang === "fr" && B.BASICS_FR[c.name]) || c.name;
const cType = c => fr(c)?.type_line || c.type_line;
const cText = c => fr(c)?.text || c.oracle_text;
const cImg = c => fr(c)?.image || c.image;
const cImgS = c => fr(c)?.image_small || c.image_small || cImg(c);
const cBack = c => fr(c)?.image_back || c.image_back;
const dfc = c => (cBack(c) ? '<span class="dfc">⇄</span>' : "");
const pips = cost => (cost || "").replace(/\{([WUBRG])\}/g, '<span class="pip $1">$1</span>').replace(/\{([^}]+)\}/g, '<span class="pip C">$1</span>');
const cNameOf = n => { const c = collection.find(x => x.name === n); return c ? cName(c) : (lang === "fr" && B.BASICS_FR[n]) || n; };

function msg(el, text, kind = "") { el.className = "msg " + kind; el.innerHTML = text; }
const spin = text => `<span class="spin"></span>${text}`;

// ------------------------------------------------------------------ langue
function applyLang() {
  document.documentElement.lang = lang;
  $$("[data-t]").forEach(el => { const v = t(el.dataset.t); if (typeof v === "string") el.textContent = v; });
  $$(".lang button").forEach(b => b.classList.toggle("on", b.dataset.l === lang));
  $("#filter").placeholder = t("filter"); $("#addSearch").placeholder = t("addPh");
  $("#wish").placeholder = t("wishPh"); $("#deckAdd").placeholder = t("addToDeckPh"); $("#deckName").placeholder = t("deckNamePh");
  renderFmtHelp(); renderSaveButtons();
  renderCollection(); renderCommanders();
  if (deck) renderDeck();
  if (lastSuggestion) renderSuggestion(lastSuggestion);
  if ($("#decks").classList.contains("on")) loadDecks();
}
$$(".lang button").forEach(b => b.onclick = () => {
  lang = b.dataset.l; try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  applyLang();
});

// ------------------------------------------------------------------ onglets
$$("nav.tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(tab) {
  $$("nav.tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === tab));
  $$("section").forEach(x => x.classList.toggle("on", x.id === tab));
  window.scrollTo({ top: 0 });
  if (tab === "collection") loadCollection();
  if (tab === "build") loadCommanders();
  if (tab === "decks") loadDecks();
}

// ------------------------------------------------------------------ fiche carte
function openSheet(c) {
  if (!c) return;
  const imgs = [cImg(c), cBack(c)].filter(Boolean).map(u => `<img src="${u}" alt="">`).join("");
  $("#sheetContent").innerHTML = `${imgs ? `<div class="imgs">${imgs}</div>` : ""}
    <h3>${esc(cName(c))}</h3><div>${pips(c.mana_cost)}</div>
    <div class="muted small">${esc(cType(c))}</div>
    <p>${esc(cText(c) || "")}</p>
    <div class="muted small">${c.price_eur != null ? c.price_eur + " €" : ""}${c.edhrec_rank ? ` · EDHREC #${c.edhrec_rank}` : ""}</div>
    ${c.scryfall_uri ? `<a class="btn ghost full" href="${c.scryfall_uri}" target="_blank" rel="noopener">Scryfall ↗</a>` : ""}`;
  $("#sheet").hidden = false;
}
$("#sheetClose").onclick = () => { $("#sheet").hidden = true; };
$("#sheet").onclick = e => { if (e.target.id === "sheet") $("#sheet").hidden = true; };

// ------------------------------------------------------------------ collection
async function refreshData() {
  collection = await S.loadCollection();
  res = await S.reservations();
  for (const c of collection) {
    c.reserved = res[c.name] || [];
    c.free = c.quantity - c.reserved.reduce((a, r) => a + r.count, 0);
  }
}
async function loadCollection() { await refreshData(); renderCollection(); }

$("#filter").oninput = renderCollection;
$("#sortBy").onchange = renderCollection;
let colRows = [];
function renderCollection() {
  const total = collection.reduce((a, c) => a + c.quantity, 0);
  const value = collection.reduce((a, c) => a + (c.price_eur || 0) * c.quantity, 0);
  $("#colCount").textContent = collection.length ? `${collection.length} ${t("cards")} · ${total} ${t("copies")} · ${value.toFixed(0)} €` : "";
  $("#colEmpty").style.display = collection.length ? "none" : "";
  $("#colEmpty").textContent = t("emptyCol");
  const q = norm($("#filter").value.trim());
  const sorters = {
    name: (a, b) => cName(a).localeCompare(cName(b)), cmc: (a, b) => a.cmc - b.cmc || cName(a).localeCompare(cName(b)),
    price: (a, b) => (b.price_eur || 0) - (a.price_eur || 0), rank: (a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9),
    qty: (a, b) => b.quantity - a.quantity,
  };
  colRows = collection.filter(c => !q || [c.name, c.type_line, c.oracle_text, c.fr?.name, c.fr?.text, c.fr?.type_line].some(x => norm(x).includes(q)))
    .sort(sorters[$("#sortBy").value] || sorters.name);
  const shown = colRows.slice(0, 300); // évite de surcharger le téléphone
  $("#colList").innerHTML = shown.map((c, i) => `<div class="crow" data-i="${i}">
      ${cImgS(c) ? `<img loading="lazy" src="${cImgS(c)}" alt="">` : '<div class="noimg"></div>'}
      <div class="ci"><b>${esc(cName(c))}${dfc(c)}</b><small>${pips(c.mana_cost)} ${esc(cType(c))}</small>
        <small>${c.price_eur != null ? c.price_eur + " € · " : ""}${t("cat")[B.category(c)]}${c.reserved.length ? ` · <span class="res">${c.reserved.map(r => `${r.count}× ${esc(r.name)}`).join(", ")}</span>` : ""}</small></div>
      <div class="qty"><button class="qb" data-d="-1">−</button><b style="color:${c.free > 0 ? "var(--txt)" : "var(--red)"}">${c.quantity}</b><button class="qb" data-d="1">+</button></div>
    </div>`).join("") + (colRows.length > 300 ? `<div class="empty">${t("refine300")(colRows.length)}</div>` : "");
  $$("#colList .crow").forEach(row => {
    const c = colRows[row.dataset.i];
    row.querySelector(".ci").onclick = () => openSheet(c);
    row.querySelector("img, .noimg").onclick = () => openSheet(c);
    row.querySelectorAll(".qb").forEach(b => b.onclick = () => changeQty(c, +b.dataset.d));
  });
}

async function changeQty(c, delta) {
  const q = await S.setQuantity(c.name, c.quantity + delta);
  const reserved = c.reserved.reduce((a, r) => a + r.count, 0);
  if (reserved > q) msg($("#colMsg"), "⚠ " + t("qtyWarn")(cName(c), reserved, q), "err"); else msg($("#colMsg"), "");
  if (q <= 0) collection = collection.filter(x => x !== c);
  else { c.quantity = q; c.free = q - reserved; }
  cmdList = []; renderCollection();
}

// ajout via recherche Scryfall
let searchTimer = null, searchSeq = 0;
$("#addSearch").oninput = () => {
  clearTimeout(searchTimer);
  const q = $("#addSearch").value.trim();
  if (q.length < 2) { $("#addResults").innerHTML = ""; msg($("#addMsg"), ""); return; }
  searchTimer = setTimeout(() => runSearch(q), 450);
};
async function runSearch(q) {
  const seq = ++searchSeq;
  msg($("#addMsg"), spin(t("searching")));
  let results;
  try { results = await SF.search(q, lang); } catch (e) { msg($("#addMsg"), t("netErr") + e.message, "err"); return; }
  if (seq !== searchSeq) return;
  const owned = Object.fromEntries(collection.map(c => [c.name, c.quantity]));
  msg($("#addMsg"), results.length ? "" : t("noResult"));
  const label = r => (lang === "fr" && r.printed_name ? r.printed_name : r.name);
  $("#addResults").innerHTML = results.map((r, i) => `<div class="res-card">${r.image_small ? `<img src="${r.image_small}" alt="">` : ""}
    <div class="ci"><b>${esc(label(r))}</b><small>${esc(r.type_line)}</small>
      <small>${esc(r.set_name || "")}${owned[r.name] ? ` · <span class="free">${t("owned")(owned[r.name])}</span>` : ""}</small></div>
    <input type="number" min="1" value="1" inputmode="numeric" id="aq${i}"><button class="btn small" data-add="${i}">${t("add")}</button></div>`).join("");
  $$("#addResults .res-card img").forEach((img, i) => img.onclick = () => openSheet({ ...results[i], oracle_text: "" }));
  $$("#addResults [data-add]").forEach(b => b.onclick = async () => {
    const r = results[b.dataset.add], qty = Math.max(1, +$("#aq" + b.dataset.add).value || 1);
    b.disabled = true;
    try {
      const cur = await S.getCard(r.name);
      let total;
      if (cur) total = await S.setQuantity(r.name, cur.quantity + qty);
      else {
        const { collection: got } = await SF.enrich([{ name: r.name, quantity: qty, set: r.set }]);
        if (!got.length) throw new Error(t("notFoundCard"));
        total = await S.setQuantity(got[0].name, qty, got[0]);
      }
      msg($("#addMsg"), t("added")(label(r), total), "ok");
      await loadCollection(); cmdList = [];
    } catch (e) { msg($("#addMsg"), t("netErr") + e.message, "err"); }
    b.disabled = false;
  });
}

// ------------------------------------------------------------------ import / sauvegarde
async function importText(filename, text) {
  const prog = $("#importProg"), m = $("#importMsg");
  prog.style.display = ""; prog.firstElementChild.style.width = "2%";
  msg(m, spin(t("importing")));
  try {
    const entries = SF.parseCollection(filename, text);
    if (!entries.length) throw new Error(t("noCardsInFile"));
    const { collection: got, notFound } = await SF.enrich(entries, (done, total, step) => {
      prog.firstElementChild.style.width = step === "fr" ? "92%" : `${Math.round(done / Math.max(total, 1) * 90)}%`;
      msg(m, spin(step === "fr" ? t("translating") : `${t("importing")} ${done}/${total}`));
    });
    if ($("#importMerge").checked) {
      for (const c of got) { const cur = await S.getCard(c.name); await S.setQuantity(c.name, (cur?.quantity || 0) + c.quantity, c); }
    } else await S.saveCollection(got);
    prog.firstElementChild.style.width = "100%";
    msg(m, t("imported")(got.length, got.reduce((a, c) => a + c.quantity, 0)) +
      (notFound.length ? `<br><span style="color:var(--red)">${t("notFound")}${esc(notFound.join(", "))}</span>` : ""), "ok");
    cmdList = []; await refreshData();
  } catch (e) { msg(m, t("netErr") + e.message, "err"); }
  setTimeout(() => { prog.style.display = "none"; }, 1200);
}
$("#file").onchange = async () => { const f = $("#file").files[0]; if (f) await importText(f.name, await f.text()); $("#file").value = ""; };
$("#sample").onclick = async () => importText("exemple.csv", await (await fetch("collection_exemple.csv")).text());

$("#exportBtn").onclick = async () => {
  const data = await S.exportBackup();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `mtg-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  msg($("#backupMsg"), t("exported")(data.collection.length, data.decks.length), "ok");
};
$("#restoreFile").onchange = async () => {
  const f = $("#restoreFile").files[0]; if (!f) return;
  try {
    const r = await S.importBackup(JSON.parse(await f.text()));
    msg($("#backupMsg"), t("restored")(r.cards, r.decks), "ok");
    cmdList = []; deck = null; $("#result").style.display = "none"; await refreshData();
  } catch (e) { msg($("#backupMsg"), e.message, "err"); }
  $("#restoreFile").value = "";
};
armButton($("#wipe"), async () => {
  await S.wipeAll(); cmdList = []; deck = null; $("#result").style.display = "none";
  await refreshData(); msg($("#backupMsg"), t("wiped"), "ok");
});

// ------------------------------------------------------------------ construction
function renderFmtHelp() {
  const f = $("#fmt").value, all = t("fmt"), [name, desc] = all[f];
  const others = Object.entries(all).filter(([k]) => k !== f).map(([, [n, d]]) => `<div><b>${n}</b> — ${d}</div>`).join("");
  $("#fmtHelp").innerHTML = `<b style="color:var(--gold2)">${name}</b> — ${desc}${f !== "commander" ? `<br><small>${t("fmtCommon")}</small>` : ""}
    <div class="other">${others}</div>`;
}
$("#fmtInfoBtn").onclick = () => $("#fmtHelp").classList.toggle("full");
$("#fmt").onchange = () => {
  const cmd = $("#fmt").value === "commander";
  $("#cmd").style.display = cmd ? "" : "none"; $("#colors").style.display = cmd ? "none" : "flex"; renderFmtHelp();
};
async function loadCommanders() {
  if (!collection.length) await refreshData();
  cmdList = B.commanders(collection);
  renderCommanders();
}
function renderCommanders() {
  const cur = $("#cmd").value;
  $("#cmd").innerHTML = `<option value="">${t("bestCmd")}</option>` +
    cmdList.map(c => `<option value="${esc(c.name)}">${esc(cName(c))} (${(c.color_identity || []).join("") || "C"})${c.reserved?.length ? " 🔒" : ""}</option>`).join("");
  $("#cmd").value = cur;
}

function makeDeck(p, body) {
  const wish = B.wishProfile(body.wish);
  if (body.format === "commander") {
    if (body.commander) return p.some(c => c.name === body.commander) ? B.buildCommander(p, body.commander, wish) : null;
    return B.bestCommander(p, wish);
  }
  return B.buildSixty(p, body.format, body.colors?.length ? body.colors : null, wish);
}

$("#go").onclick = () => build({
  format: $("#fmt").value, commander: $("#cmd").value,
  colors: $$("#colors input:checked").map(i => i.value),
  use_reserved: $("#useRes").checked, include_external: $("#useExt").checked, wish: $("#wish").value.trim(),
}, true);
$("#wish").onkeydown = e => { if (e.key === "Enter") $("#go").click(); };

async function build(body, fresh) {
  const m = $("#buildMsg"), btn = $("#go"); btn.disabled = true;
  msg(m, spin(t("building")));
  await new Promise(r => setTimeout(r, 30)); // laisse le spinner s'afficher
  if (fresh) { currentDeckId = null; currentDeckName = ""; }
  lastBody = body;
  try {
    const col = await S.loadCollection();
    if (!col.length) throw new Error(t("importFirst"));
    const r = await S.reservations(currentDeckId);
    const free = S.availableSync(col, r);
    let d = makeDeck(body.use_reserved ? col : free, body);
    let suggestion = null;
    if (!body.use_reserved && Object.keys(r).length) {
      const full = makeDeck(col, body);
      if (full && (!d || full.total > d.total || full.score > d.score + 0.02)) {
        const borrow = await S.borrowReport(full, col, currentDeckId);
        if (borrow.length) {
          const deckIds = new Map(); borrow.forEach(b => b.decks.forEach(x => deckIds.set(x.id, x.name)));
          suggestion = { cards: borrow, decks: [...deckIds], score_gain: Math.round((full.score - (d?.score || 0)) * 100), total_gain: full.total - (d?.total || 0) };
        }
      }
    }
    renderSuggestion(suggestion);
    if (!d) throw new Error(t("cannotBuild"));
    if (body.include_external) d = await withExternal(d, body.use_reserved ? col : free, body);
    d.borrowed = body.use_reserved ? await S.borrowReport(d, col, currentDeckId) : [];
    deck = d;
    msg(m, ""); msg($("#saveMsg"), ""); msg($("#editMsg"), "");
    $("#deckName").value = currentDeckName || defaultName(deck);
    renderSaveButtons(); renderDeck();
    $("#result").scrollIntoView({ behavior: "smooth" });
  } catch (e) { msg(m, e.message, "err"); }
  btn.disabled = false;
}

async function withExternal(d, ownedPool, body) {
  msg($("#buildMsg"), spin(t("fetchingExt")));
  let ext;
  try { ext = await SF.topCards(d.format, d.identity); }
  catch (e) { d.warnings.push({ k: "extErr", e: e.message }); return d; }
  const cap = d.format === "commander" ? 1 : 4;
  const fixed = { ...body, colors: d.identity, commander: d.commander?.name || body.commander };
  const nd = makeDeck(B.mergeExternal(ownedPool, ext, cap), fixed) || d;
  const byName = new Map(ext.map(c => [c.name, c]));
  await SF.frenchFor(nd.cards.filter(c => c.missing && byName.has(c.name)).map(c => byName.get(c.name)));
  for (const c of nd.cards) if (!c.fr && byName.get(c.name)?.fr) c.fr = byName.get(c.name).fr;
  return nd;
}

function renderSuggestion(sg) {
  lastSuggestion = sg || null;
  if (!sg) { $("#suggest").innerHTML = ""; return; }
  $("#suggest").innerHTML = `<div class="suggest"><b>${t("suggestTitle")(sg.score_gain, sg.total_gain)}</b>
    <ul>${sg.cards.map(c => `<li>${c.count}× ${esc(cNameOf(c.name))} — ${t("inDeck")} ${c.decks.map(d => "« " + esc(d.name) + " »").join(", ")}</li>`).join("")}</ul>
    <div class="small" style="opacity:.85;margin-bottom:8px">${t("suggestWhy")}</div>
    <button class="btn small full" id="useAnyway">${t("useAnyway")}</button>
    ${sg.decks.map(([id, name]) => `<button class="btn small danger full" data-break="${id}">${t("breakDeck")(esc(name))}</button>`).join("")}</div>`;
  $("#useAnyway").onclick = () => { $("#useRes").checked = true; build({ ...lastBody, use_reserved: true }, false); };
  $$("#suggest [data-break]").forEach(b => armBreak(b, () => build({ ...lastBody }, false)));
}

const defaultName = d => (d.commander ? cName(d.commander) : `${d.format[0].toUpperCase() + d.format.slice(1)} ${d.identity.join("")}`);

function warnText(w) {
  if (typeof w === "string") return w;
  const W = t("warn");
  return W[w.k] ? W[w.k](w) : JSON.stringify(w);
}

function buyBadge(x) {
  if (!x.missing) return "";
  return x.owned ? `<span class="badge part">${x.owned}/${x.count}</span>` : '<span class="badge buy">🛒</span>';
}

function renderDeck() {
  $("#result").style.display = "block";
  const id = deck.identity.map(c => `<span class="pip ${c}">${c}</span>`).join("") || '<span class="pip C">C</span>';
  $("#stats").innerHTML = [
    [deck.total + (deck.commander ? 1 : 0), t("stCards")], [deck.avg_cmc, t("stCmc")], [id, t("stId")],
    [Math.min(100, deck.score * 100).toFixed(0) + "/100", t("stScore")], [deck.value_eur + " €", t("stValue")],
    ...(deck.to_buy?.length ? [[`${deck.to_buy.reduce((a, b) => a + b.count, 0)} · ${deck.buy_cost} €`, t("stBuy")]] : []),
    [deck.themes?.length ? deck.themes.join(", ") : "–", t("stThemes")],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");

  const w = deck.wish;
  $("#warnings").innerHTML = (w ? `<div class="wishbox">🎯 <b>${t("yourWish")}</b> « ${esc(w.text)} »<br>
      <span class="tags">${w.matched.length ? t("understood") + " " + w.matched.map(x => `<span>${esc(x)}</span>`).join("") + ` — ${t("fit")(Math.round(w.fit * 100))}` : t("notUnderstood")}</span></div>` : "") +
    (deck.warnings || []).map(x => `<div class="warn">⚠ ${esc(warnText(x))}</div>`).join("") +
    (deck.borrowed?.length ? `<div class="borrowed">🔁 ${t("borrowedMsg")} ${deck.borrowed.map(b => `${b.count}× ${esc(cNameOf(b.name))} (${b.decks.map(d => "« " + esc(d.name) + " »").join(", ")})`).join(" · ")}</div>` : "");

  const c = deck.commander;
  $("#cmdBox").innerHTML = c ? `<div class="card cmdbox"><div class="faces">${[cImg(c), cBack(c)].filter(Boolean).map(u => `<img src="${u}" alt="">`).join("")}</div>
     <div><h2>${esc(cName(c))}</h2><div>${pips(c.mana_cost)}</div><p>${esc(cText(c))}</p></div></div>` : "";
  if (c) $("#cmdBox .faces").onclick = () => openSheet(c);

  const key = groupBy === "type" ? x => B.mainType(x.type_line) : x => x.category;
  const order = groupBy === "type" ? [...B.TYPE_ORDER, "Other"] : ["creature", "ramp", "draw", "removal", "wipe", "other", "land"];
  const labels = groupBy === "type" ? t("types") : t("cat");
  const byCat = {}; deck.cards.forEach(x => (byCat[key(x)] ||= []).push(x));
  Object.values(byCat).forEach(l => l.sort((a, b) => a.cmc - b.cmc || cName(a).localeCompare(cName(b))));
  $("#list").innerHTML = order.filter(k => byCat[k]).map(k => {
    const n = byCat[k].reduce((a, x) => a + x.count, 0);
    return `<h3>${labels[k]} (${n})</h3><ul>${byCat[k].map((x, i) => `<li data-k="${k}" data-i="${i}" class="${x.missing ? (x.owned ? "partial" : "buy") : ""}">
      <span class="n">${x.count}</span><span class="nm">${esc(cName(x))}${dfc(x)}${x.wish ? '<span class="star">★</span>' : ""}${buyBadge(x)}</span>
      <span class="mc">${pips(x.mana_cost)}</span>
      <span class="qbs"><button class="qb" data-d="-1">−</button><button class="qb" data-d="1">+</button></span></li>`).join("")}</ul>`;
  }).join("");
  $$("#list li").forEach(li => {
    const x = byCat[li.dataset.k][li.dataset.i];
    li.querySelector(".nm").onclick = () => openSheet(x);
    li.querySelectorAll(".qb").forEach(b => b.onclick = () =>
      editDeck(+b.dataset.d > 0 ? { add: [{ name: x.name, count: 1 }] } : { remove: [{ name: x.name, count: 1 }] }));
  });
  $("#legend").innerHTML = deck.to_buy?.length ? `<span><i style="background:var(--buy)"></i>${t("legendBuy")}</span><span><i style="border:1px dashed var(--buy)"></i>${t("legendPartial")}</span>` : "";

  renderShop();
  const max = Math.max(...Object.values(deck.curve), 1);
  $("#curve").innerHTML = Object.entries(deck.curve).map(([k, v]) => `<div>${v || ""}<i style="height:${v / max * 85}%"></i>${k === "7" ? "7+" : k}</div>`).join("");
  const types = deck.types || {}, tmax = Math.max(...Object.values(types), 1);
  $("#types").innerHTML = [...B.TYPE_ORDER, "Other"].filter(k => types[k]).map(k =>
    `<div class="tr"><span>${t("types")[k]}</span><div class="bar"><i style="width:${types[k] / tmax * 100}%"></i></div><b>${types[k]}</b></div>`).join("");
  loadPool();
}

$$("#groupBy button").forEach(b => b.onclick = () => {
  groupBy = b.dataset.g; $$("#groupBy button").forEach(x => x.classList.toggle("on", x === b));
  if (deck) renderDeck();
});

function renderShop() {
  const list = deck.to_buy || [];
  $("#shopCard").style.display = list.length ? "" : "none";
  if (!list.length) return;
  const byName = Object.fromEntries(deck.cards.map(c => [c.name, c]));
  $("#shopList").innerHTML = list.map(b => {
    const c = byName[b.name] || b;
    return `<div class="srow"><span>×${b.count} ${b.scryfall_uri ? `<a href="${b.scryfall_uri}" target="_blank" rel="noopener">${esc(cName(c))}</a>` : esc(cName(c))}
      ${b.owned ? `<small class="muted">(${t("ownedN")(b.owned)})</small>` : ""}</span><span>${b.price_eur != null ? (b.price_eur * b.count).toFixed(2) + " €" : "?"}</span></div>`;
  }).join("");
  const unknown = list.filter(b => b.price_eur == null).length;
  $("#shopTot").textContent = `${t("total")} ${deck.buy_cost} €` + (unknown ? ` (+${unknown} ${t("noPrice")})` : "");
}

async function copyText(text, btn, label) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove();
  }
  btn.textContent = t("copied"); setTimeout(() => { btn.textContent = t(label); }, 1500);
}
$("#copy").onclick = () => copyText([...(deck.commander ? [`1 ${deck.commander.name}`, ""] : []), ...deck.cards.map(x => `${x.count} ${x.name}`)].join("\n"), $("#copy"), "copy");
$("#copyShop").onclick = () => copyText((deck.to_buy || []).map(b => `${b.count} ${b.name}`).join("\n"), $("#copyShop"), "copyShop");

// ------------------------------------------------------------------ édition manuelle
async function editPool() {
  const col = await S.loadCollection();
  return $("#useRes").checked ? col : S.available(col, currentDeckId);
}
function logText(l) {
  return l.ok ? `${l.sign} ${l.n} ${cNameOf(l.name)}` : `✗ ${cNameOf(l.name)} : ${t("editErr")[l.k]}`;
}
async function editDeck(changes) {
  const { deck: nd, log } = B.applyChanges(deck, await editPool(), changes.remove || [], changes.add || []);
  const errs = log.filter(l => !l.ok);
  msg($("#editMsg"), esc(log.map(logText).join(" · ")), errs.length ? "err" : "ok");
  if (errs.length < log.length) { deck = nd; renderDeck(); }
}

async function loadPool() {
  const p = await editPool();
  const inDeck = Object.fromEntries(deck.cards.map(c => [c.name, c.count]));
  const cap = deck.format === "commander" ? 1 : 4;
  pool = B.legalPool(p, deck).map(c => ({ ...c, free: Math.min(c.quantity, cap) - (inDeck[c.name] || 0) }))
    .filter(c => c.free > 0).sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));
  renderPool();
}
function renderPool() {
  const q = norm($("#deckAdd").value.trim()), el = $("#poolResults");
  if (!q) { el.innerHTML = ""; return; }
  const hits = pool.filter(p => [p.name, p.fr?.name, p.type_line, p.fr?.type_line, p.oracle_text, p.fr?.text].some(x => norm(x).includes(q))).slice(0, 30);
  if (!hits.length) { el.innerHTML = `<div class="muted small">${t("noPoolHit")}</div>`; return; }
  el.innerHTML = hits.map((p, i) => `<div class="res-card">${cImgS(p) ? `<img src="${cImgS(p)}" alt="">` : ""}
    <div class="ci"><b>${esc(cName(p))}${dfc(p)}</b><small>${esc(cType(p))}</small><small>${pips(p.mana_cost)} <span class="free">${t("freeN")(p.free)}</span></small></div>
    <button class="qb" data-pa="${i}">+</button></div>`).join("");
  $$("#poolResults .res-card").forEach((c, i) => { c.querySelector(".ci").onclick = () => openSheet(hits[i]); });
  $$("#poolResults [data-pa]").forEach(b => b.onclick = () => editDeck({ add: [{ name: hits[b.dataset.pa].name, count: 1 }] }));
}
$("#deckAdd").oninput = renderPool;

// ------------------------------------------------------------------ enregistrement / decks
function renderSaveButtons() {
  $("#saveDeck").textContent = currentDeckId ? t("updateDeck") : t("saveDeck");
  $("#saveNew").style.display = currentDeckId ? "" : "none";
}
async function saveDeck(asNew) {
  const name = $("#deckName").value.trim() || defaultName(deck);
  const e = await S.saveDeck(name, deck, asNew ? null : currentDeckId);
  currentDeckId = e.id; currentDeckName = e.name; renderSaveButtons();
  msg($("#saveMsg"), t("saved")(e.name), "ok");
  renderSuggestion(null); await refreshData();
}
$("#saveDeck").onclick = () => saveDeck(false);
$("#saveNew").onclick = () => saveDeck(true);

// bouton en deux temps (pas de popup de confirmation)
function armButton(btn, action) {
  btn.onclick = async () => {
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed"); btn.dataset.label = btn.textContent; btn.textContent = t("confirm");
      setTimeout(() => { if (btn.isConnected && btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = btn.dataset.label; } }, 3000);
      return;
    }
    btn.classList.remove("armed");
    await action();
  };
}
function armBreak(btn, after) {
  armButton(btn, async () => {
    const d = await S.deleteDeck(btn.dataset.break);
    if (btn.dataset.break === currentDeckId) { currentDeckId = null; currentDeckName = ""; renderSaveButtons(); }
    const n = d ? Object.values(S.deckCards(d.deck)).reduce((a, b) => a + b, 0) : 0;
    const text = t("broken")(d?.name || "?", n);
    msg($("#buildMsg"), text, "ok"); msg($("#decksFlash"), text, "ok");
    await refreshData();
    if (after) after();
  });
}

async function loadDecks() {
  await refreshData();
  const list = await S.listDecks();
  const el = $("#deckList");
  if (!list.length) { el.innerHTML = `<div class="card empty">${t("noDecks")}</div>`; return; }
  const items = await Promise.all(list.map(async d => ({ ...d, borrowed: await S.borrowReport(d.deck, collection, d.id) })));
  el.innerHTML = items.map((d, i) => {
    const dk = d.deck, c = dk.commander, img = c ? cImg(c) : null;
    const id = dk.identity.map(x => `<span class="pip ${x}">${x}</span>`).join("") || '<span class="pip C">C</span>';
    return `<div class="dk">${img ? `<img src="${img}" alt="">` : ""}<div class="dkb">
      <h3>${esc(d.name)}</h3>
      <div class="meta">${id} · ${dk.format} · ${dk.total + (c ? 1 : 0)} ${t("stCards")} · ${dk.value_eur} €${dk.to_buy?.length ? ` · 🛒 ${dk.buy_cost} €` : ""} · ${d.saved_at}</div>
      ${d.borrowed.length ? `<div class="borrowed">${t("shares")} ${d.borrowed.map(b => `${b.count}× ${esc(cNameOf(b.name))}`).join(", ")}</div>` : ""}
      <button class="btn small full" data-open="${i}">${t("open")}</button>
      <button class="btn small danger full" data-break="${d.id}">${t("breakDeck")(esc(d.name))}</button></div></div>`;
  }).join("");
  $$("#deckList [data-open]").forEach(b => b.onclick = () => {
    const d = items[b.dataset.open];
    deck = d.deck; currentDeckId = d.id; currentDeckName = d.name;
    lastBody = { format: deck.format, commander: deck.commander?.name || "", colors: deck.identity, use_reserved: false };
    msg($("#saveMsg"), ""); msg($("#editMsg"), ""); renderSuggestion(null);
    $("#deckName").value = d.name; renderSaveButtons();
    showTab("build"); renderDeck();
  });
  $$("#deckList [data-break]").forEach(b => armBreak(b, loadDecks));
}

// ------------------------------------------------------------------ démarrage
applyLang();
loadCollection();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* hors ligne non disponible */ });
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
