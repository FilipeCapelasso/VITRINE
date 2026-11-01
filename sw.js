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
