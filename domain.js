export const pad = n => String(n).padStart(3, '0');
export const digits = value => String(value || '').replace(/\D/g, '');
export function numberId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('Escolha um número de 1 a 100.');
  return pad(n);
}
export function whatsappNumber(value) {
  const n = digits(value);
  if (!n) return '';
  if (n.length === 10 || n.length === 11) return '55' + n;
  if ((n.length === 12 || n.length === 13) && n.startsWith('55')) return n;
  throw new Error('Informe um WhatsApp com DDD, por exemplo 55 66 90000-0000.');
}
export function safeImage(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) && url.length <= 700000) return url;
  try { const u = new URL(url); if (u.protocol === 'https:' && !u.username && !u.password && url.length <= 2000) return url; } catch {}
  throw new Error('Use uma foto JPG, PNG ou WebP, ou um endereço HTTPS válido.');
}
export function entryData(raw) {
  const e = { name: String(raw.name || '').trim(), phone: digits(raw.phone), email: String(raw.email || '').trim(), city: String(raw.city || '').trim(), uf: String(raw.uf || '').trim().toUpperCase(), address: String(raw.address || '').trim(), cep: String(raw.cep || '').trim(), number: numberId(raw.number) };
  if (e.name.length < 3 || e.name.length > 100) throw new Error('Preencha o nome completo.');
  if (!/^[0-9]{10,13}$/.test(e.phone)) throw new Error('Preencha o telefone com DDD.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email) || e.email.length > 150) throw new Error('Informe um e-mail válido.');
  if (e.city.length < 2 || e.city.length > 80) throw new Error('Preencha a cidade.');
  if (!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(e.uf)) throw new Error('Informe uma UF válida.');
  if (e.address.length > 180 || (e.cep && !/^[0-9]{5}-?[0-9]{3}$/.test(e.cep))) throw new Error('Confira o endereço e o CEP.');
  return e;
}
export function chooseNumber(ids, random = a => crypto.getRandomValues(a)) {
  if (!ids.length) throw new Error('Nenhum número resgatado para sortear.');
  const limit = Math.floor(4294967296 / ids.length) * ids.length;
  const buffer = new Uint32Array(1);
  do { random(buffer); } while (buffer[0] >= limit);
  return ids[buffer[0] % ids.length];
}
