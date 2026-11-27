/* Cache das FOTOS do site no aparelho do cliente.
   Quem volta ao site (ou navega entre as motos) não baixa as mesmas fotos de novo do Supabase,
   o que reduz o "Cached Egress". Só guarda imagens do armazenamento público; vídeos, páginas e
   dados NUNCA passam por aqui (continuam sempre atualizados). Se algo falhar, o site funciona normal. */
const CACHE = 'midia-v1';
const MAX = 250; // no máximo ~250 fotos guardadas (as mais antigas saem primeiro)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('midia-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

function ehFoto(r) {
  if (r.method !== 'GET' || r.headers.has('range')) return false;
  let u; try { u = new URL(r.url); } catch (e) { return false; }
  return /\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith('/storage/v1/object/public/') &&
    (r.destination === 'image' || /\.(webp|jpe?g|png|gif|avif)$/i.test(u.pathname));
}
async function enxuga(c) {
  const ks = await c.keys();
  if (ks.length > MAX) for (const k of ks.slice(0, ks.length - MAX)) await c.delete(k);
}
self.addEventListener('fetch', e => {
  const r = e.request;
  if (!ehFoto(r)) return;                       // tudo o que não é foto: segue direto, sem tocar
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const guardada = await c.match(r.url);
    if (guardada) return guardada;               // já tem: não gasta nada do Supabase
    try {
      const res = await fetch(r.url, { mode: 'cors', credentials: 'omit' });  // com CORS dá para conferir se deu certo
      if (res && res.status === 200) c.put(r.url, res.clone()).then(() => enxuga(c)).catch(() => {});
      return res;
    } catch (err) { return fetch(r); }           // qualquer problema: pede normalmente
  })());
});

/* ===== AVISOS DO PAINEL DO VENDEDOR (Web Push, sem Firebase/Expo) =====
   O servidor (função web-push do Supabase) manda o aviso criptografado; aqui ele vira notificação.
   Tocar no aviso abre o WhatsApp do cliente com a mensagem pronta (ou o painel, se ainda não tem celular). */
const UA = self.navigator.userAgent || '';
const ehIOS = /iphone|ipad|ipod/i.test(UA) || (/macintosh/i.test(UA) && /safari/i.test(UA) && !/chrome|crios|edg|firefox/i.test(UA)); // Safari da Apple (iPhone/iPad/Mac)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'Novo aviso', b: e.data ? e.data.text() : '' }; }
  const adm = !!d.admin;   // aviso do Admin Geral (dono)
  const base = d.slug ? `/${d.slug}/admin` : '/';
  const url = adm ? `/?app=admin&av=${encodeURIComponent(d.id || '')}#admin`
    : d.slug ? `${base}?app=1&t=vendas${d.cid ? '&c=' + encodeURIComponent(d.cid) : ''}${d.wa ? '&wa=' + encodeURIComponent(d.wa) : ''}` : '/';
  const acoes = [];
  if (d.wa) acoes.push({ action: 'wa', title: '💬 Chamar no WhatsApp' });
  acoes.push({ action: 'abrir', title: adm ? 'Abrir Admin Geral' : 'Abrir painel' });
  e.waitUntil((async () => {
    const abertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
    abertos.forEach(c => { try { c.postMessage({ tipo: 'push', d }); } catch (x) {} });
    // Painel aberto e visível na tela: o aviso aparece animado dentro dele (Android/computador).
    // No iPhone a notificação é sempre mostrada (a Apple exige).
    const naTela = !ehIOS && abertos.some(c => { if (c.visibilityState !== 'visible') return false; const u = new URL(c.url);
      return adm ? (u.pathname === '/' && u.hash === '#admin') : /\/admin\/?$/.test(u.pathname); });
    if (naTela && d.tp !== 'teste') return;
    await self.registration.showNotification(d.t || (adm ? 'Admin Geral' : 'Novo cliente no seu site'), {
      body: d.b || '', icon: adm ? '/admin-geral-192.png' : '/app-honda2-192.png', badge: '/app-honda2-badge.png',
      ...(d.img ? { image: d.img } : {}),
      // mesma pessoa (pk = celular): o aviso novo substitui o anterior dela em vez de empilhar
      tag: (adm ? 'a-' : '') + (d.pk ? 'p-' + d.pk : d.cid ? 'c-' + d.cid : 'n-' + (d.id || Date.now())), renotify: true,
      requireInteraction: d.tp !== 'teste', silent: false, vibrate: [200, 100, 200, 100, 300],
      timestamp: d.em ? Date.parse(d.em) : Date.now(),
      data: { url, wa: d.wa || null, id: d.id || null, tp: d.tp || '' }, actions: acoes,
    });
    try { if (self.navigator.setAppBadge && d.n > 0) await self.navigator.setAppBadge(d.n); } catch (x) {}
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const dd = e.notification.data || {};
  // No Android/computador o toque vai direto ao WhatsApp do cliente; no iPhone abre o painel com o botão do WhatsApp.
  const alvo = e.action === 'abrir' ? dd.url : e.action === 'wa' ? dd.wa : (dd.wa && !ehIOS ? dd.wa : dd.url);
  e.waitUntil((async () => {
    if (!alvo) return;
    if (alvo === dd.url) {
      const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const p = new URL(alvo, self.location.origin).pathname;
      for (const c of cs) {
        if (new URL(c.url).pathname === p && (p !== '/' || new URL(c.url).hash === '#admin') && 'focus' in c) {
          try { c.postMessage({ tipo: 'abrir', url: alvo }); } catch (x) {}
          return c.focus();
        }
      }
    }
    return self.clients.openWindow(alvo);
  })());
});
