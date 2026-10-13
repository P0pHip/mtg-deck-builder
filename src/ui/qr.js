// QR code d'un lien (deck, classeur d'échange) affiché en grand dans la fenêtre du bas, à scanner avec un autre téléphone.
import { $, esc } from "./dom.js";
import { t } from "./state.js";

/** Noir sur blanc : les appareils photo le lisent mieux. La bibliothèque n'est chargée qu'à la première utilisation. */
export async function showQr(url, title, help = t("exQrHelp")) {
  const { renderSVG } = await import("uqr");
  $("#sheetContent").innerHTML = `<h3>${esc(title)}</h3>
    <div class="qrbox">${renderSVG(url, { ecc: "L", border: 2, whiteColor: "#fff", blackColor: "#000" })}</div>
    <p class="muted small">${help}</p>`;
  $("#sheet").hidden = false;
}