// Cas d'usage « cartes prêtées » : prêter, rendre, voir qui a quoi. Les prêts comptent comme des réservations
// (voir decksRepo.reservations) : une carte prêtée n'est plus proposée pour construire.
import * as core from "../core/index.js";
import { listLoans, saveLoans } from "../data/loansRepo.js";

const today = () => new Date().toLocaleDateString("sv"); // AAAA-MM-JJ, date locale (pas UTC : un prêt à minuit et demi est bien du jour)
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const loans = listLoans;

/** Prête `count` exemplaires d'une carte à `to`. */
export async function lend(name, count, to) {
  if (!to?.trim()) throw new Error("no-borrower");
  await saveLoans(core.addLoan(await listLoans(), { id: newId(), name, count, to, date: today() }));
}

/** Carte rendue. */
export async function giveBack(id) {
  await saveLoans(core.returnLoan(await listLoans(), id));
}

/** Tous les prêts d'une personne rendus d'un coup. */
export async function giveBackAll(to) {
  const k = to.toLowerCase();
  await saveLoans((await listLoans()).filter(l => l.to.toLowerCase() !== k));
}