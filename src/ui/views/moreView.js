// Onglet « Plus » : import de fichier, sauvegarde / restauration, effacement.
import * as backup from "../../data/backup.js";
import * as collectionService from "../../services/collectionService.js";
import { $, armButton, esc, msg, spin } from "../dom.js";
import { t } from "../state.js";

let refreshAll = async () => {};

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
    await refreshAll();
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `mtg-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    msg($("#backupMsg"), t("exported")(data.collection.length, data.decks.length), "ok");
  };
  $("#restoreFile").onchange = async () => {
    const f = $("#restoreFile").files[0];
    if (!f) return;
    try {
      const r = await backup.importBackup(JSON.parse(await f.text()));
      msg($("#backupMsg"), t("restored")(r.cards, r.decks), "ok");
      onReset(); await refreshAll();
    } catch (e) { msg($("#backupMsg"), e.message, "err"); }
    $("#restoreFile").value = "";
  };
  armButton($("#wipe"), async () => {
    await backup.wipeAll();
    onReset(); await refreshAll();
    msg($("#backupMsg"), t("wiped"), "ok");
  }, () => t("confirm"));
}

