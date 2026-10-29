/** Sends no customer data. Timeout and malformed responses are delivery-unknown. */
export async function sendTelegramTest({ token, getRecipient, fetchImpl = fetch }) {
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) || typeof getRecipient !== 'function') return {ok:false,reason:'unavailable'};
  try {
    const chatId = await getRecipient();
    if (typeof chatId !== 'string' || !/^[1-9]\d{0,19}$/.test(chatId)) return {ok:false,reason:'unavailable'};
    const response=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(8000),
      body:JSON.stringify({chat_id:chatId,text:'رسالة اختبار من متجر رواء. هذه ليست طلبًا جديدًا. تنبيهات الطلبات لم تُفعّل بعد.'})
    });
    if (!response.ok) return {ok:false,reason:'unknown'};
    const data=await response.json();
    if (data?.ok !== true || !Number.isSafeInteger(data.result?.message_id) || String(data.result?.chat?.id) !== chatId) return {ok:false,reason:'unknown'};
    return {ok:true};
  } catch { return {ok:false,reason:'unknown'}; }
}
