// Cartes prêtées : à qui, combien, depuis quand. Pur : chaque action renvoie une nouvelle liste.
// Une carte prêtée compte comme « rangée » : elle n'est plus proposée pour construire tant qu'elle n'est pas rendue.

/** Prête `count` exemplaires de `name` à `to`. */
export function addLoan(loans, { id, name, count = 1, to, date = "" }) {
  return [...loans, { id, name, count: Math.max(1, count), to: to.trim(), date }];
}

/** Carte rendue : le prêt disparaît. */
export const returnLoan = (loans, id) => loans.filter(l => l.id !== id);

/** Prêts vus comme des réservations, comme les decks : { nomCarte: [{ id, name, count, loan: true }] }. */
export function loanReservations(loans) {
  const res = {};
  for (const l of loans) (res[l.name] ||= []).push({ id: `loan:${l.id}`, name: `🤝 ${l.to}`, count: l.count, loan: true });
  return res;
}

/** Collection sans les exemplaires prêtés (ce qu'on a vraiment sous la main). */
export function withoutLoans(collection, loans) {
  const lent = {};
  for (const l of loans) lent[l.name] = (lent[l.name] || 0) + l.count;
  return collection.map(c => (lent[c.name] ? { ...c, quantity: c.quantity - lent[c.name] } : c)).filter(c => c.quantity > 0);
}

/** Prêts regroupés par personne (ordre alphabétique), chaque groupe du plus ancien au plus récent. */
export function loansByPerson(loans) {
  const groups = new Map();
  for (const l of loans) {
    const k = l.to.toLowerCase();
    if (!groups.has(k)) groups.set(k, { to: l.to, loans: [], count: 0 });
    const g = groups.get(k);
    g.loans.push(l); g.count += l.count;
  }
  for (const g of groups.values()) g.loans.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return [...groups.values()].sort((a, b) => a.to.localeCompare(b.to));
}

/** Personnes à qui on a déjà prêté (pour proposer leur nom), sans doublon de majuscules (première écriture gardée). */
export function borrowers(loans) {
  const seen = new Map();
  for (const l of loans) if (!seen.has(l.to.toLowerCase())) seen.set(l.to.toLowerCase(), l.to);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
