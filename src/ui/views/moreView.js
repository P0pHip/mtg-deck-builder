// Onglet « Plus » : import de fichier, sauvegarde / restauration, effacement.
import * as backup from "../../data/backup.js";
import * as collectionService from "../../services/collectionService.js";
import { $, armButton, esc, msg, spin } from "../dom.js";
import { t } from "../state.js";

let refreshAll = async () => {};

// ------------------------------------------------------------ partage de la sauvegarde (téléphone)
// Le téléphone n'autorise le partage que dans l'instant qui suit l'appui : la sauvegarde est donc préparée à l'avance
// (à l'ouverture de l'onglet, après un import…), et le bouton lance le partage tout de suite.
let shareKind = null, ready = null;
const today = () => new Date().toISOString().slice(0, 10);

/** Type de fichier que le téléphone accepte de partager : .json si possible, sinon le même contenu en .txt. */
function detectShareKind() {
  for (const [ext, type] of [["json", "application/json"], ["txt", "text/plain"]]) {
    if (navigator.canShare?.({ files: [new File(["{}"], `test.${ext}`, { type })] })) return { ext, type };
  }
  return null;
}

/** Prépare la sauvegarde à partager (appelée à l'ouverture de l'onglet « Plus » et après chaque changement). */
export async function prepareShare() {
  if (!shareKind) return;
  const data = await backup.exportBackup();
  ready = { data, file: new File([JSON.stringify(data)], `mtg-sauvegarde-${today()}.${shareKind.ext}`, { type: shareKind.type }) };
}

function download(file) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function shareBackup() {
  if (!ready) { msg($("#backupMsg"), spin(t("sharePreparing"))); prepareShare().then(() => msg($("#backupMsg"), t("shareReady"))); return; }
  const { data, file } = ready;
  // aucun « await » avant navigator.share : sinon le téléphone refuse (« Permission denied »)
  navigator.share({ files: [file], title: "MTG Deck Builder", text: t("shareText") })
    .then(() => msg($("#backupMsg"), t("exported")(data.collection.length, data.decks.length), "ok"))
    .catch(e => {
      if (e.name === "AbortError") return; // partage annulé par le joueur
      download(file); // partage refusé par le téléphone : la sauvegarde est téléchargée à la place
      msg($("#backupMsg"), t("shareFallback")(esc(e.message)), "err");
    });
}

async function importText(filename, text) {
  const prog = $("#importProg"), bar = prog.firstElementChild, m = $("#importMsg");
  prog.style.display = ""; bar.style.width = "2%";
  msg(m, spin(t("importing")));
  try {
    const r = await collectionService.importFile(filename, text, {
      merge: $("#importMerge").checked,
      onProgress: (done, total, step) => {
        bar.style.width = step === "fr" ? "92%" : `${Math.round(done / Math.max(total, 1) * 90)}%`;
        msg(m, spin(step === "fr" ? t("translating") : `${t("importing")} ${done}/${total}`));
      },
    });
    bar.style.width = "100%";
    msg(m, t("imported")(r.cards, r.copies) +
      (r.notFound.length ? `<br><span style="color:var(--red)">${t("notFound")}${esc(r.notFound.join(", "))}</span>` : ""), "ok");
    await refreshAll(); prepareShare();
  } catch (e) {
    msg(m, t("netErr") + (e.message === "no-cards" ? t("noCardsInFile") : e.message), "err");
  }
  setTimeout(() => { prog.style.display = "none"; }, 1200);
}

export function init({ onRefreshAll, onReset }) {
  refreshAll = onRefreshAll;
  $("#file").onchange = async () => {
    const f = $("#file").files[0];
    if (f) await importText(f.name, await f.text());
    $("#file").value = "";
  };
  $("#sample").onclick = async () => importText("exemple.csv", await (await fetch("collection_exemple.csv")).text());

  $("#exportBtn").onclick = async () => {
    const data = await backup.exportBackup();
    download(new File([JSON.stringify(data)], `mtg-sauvegarde-${today()}.json`, { type: "application/json" }));
    msg($("#backupMsg"), t("exported")(data.collection.length, data.decks.length), "ok");
  };
  // téléphone : partage natif (messagerie, Drive, e-mail…) pour passer la sauvegarde sur un autre appareil
  shareKind = detectShareKind();
  $("#shareBtn").hidden = !shareKind;
  $("#shareBtn").onclick = shareBackup;
  $("#restoreFile").onchange = async () => {
    const f = $("#restoreFile").files[0];
    if (!f) return;
    try {
      const r = await backup.importBackup(JSON.parse(await f.text()));
      msg($("#backupMsg"), t("restored")(r.cards, r.decks), "ok");
      onReset(); await refreshAll(); prepareShare();
    } catch (e) { msg($("#backupMsg"), e.message, "err"); }
    $("#restoreFile").value = "";
  };
  armButton($("#wipe"), async () => {
    await backup.wipeAll();
    onReset(); await refreshAll(); prepareShare();
    msg($("#backupMsg"), t("wiped"), "ok");
  }, () => t("confirm"));
}

