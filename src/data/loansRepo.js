// Cartes prêtées, stockées localement (IndexedDB, clé « loans ») et incluses dans les sauvegardes.
import { kvGet, kvSet } from "./db.js";

const KEY = "loans";

export const listLoans = async () => (await kvGet(KEY)) || [];
export const saveLoans = loans => kvSet(KEY, loans);
