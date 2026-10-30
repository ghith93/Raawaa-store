import { createOutboxRunner } from './outbox-runner.mjs';

/** Trusted scheduler only. Each run is bounded and never retries ambiguous sends. */
export function createOutboxBatch({ db, token, fetchImpl = fetch, maxItems = 3 }) {
  if (typeof db?.query !== 'function' || typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) ||
      typeof fetchImpl !== 'function' || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 3) throw new Error('INVALID_CONFIGURATION');
  async function run() {
    // Recover expired leases even if the Telegram destination has since disappeared.
    const recovery = createOutboxRunner({db, token, chatId:'', fetchImpl});
    const expired = await recovery.recoverExpired();
    const recipients = await db.query('select chat_id::text as chat_id from rawaa_store.telegram_recipient where singleton=true', []);
    const chatId=recipients.rows.length === 1 ? recipients.rows[0].chat_id : null;
    if (typeof chatId !== 'string' || !/^[1-9]\d{0,19}$/.test(chatId)) return {ok:false,reason:'not_paired',recovered:expired.count};
    const runner=createOutboxRunner({db,token,chatId,fetchImpl});
    const totals={sent:0,failed:0,unknown:0};
    for(let n=0;n<maxItems;n++) {
      const result=await runner.processNext();
      if(result.state==='no_pending') break;
      if(!Object.hasOwn(totals,result.state)) throw new Error('INVALID_STATE');
      totals[result.state]++;
    }
    return {ok:true,recovered:expired.count,...totals};
  }
  return {run};
}
