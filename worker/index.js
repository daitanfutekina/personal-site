// Cloudflare Worker: serves the static site and handles POST /api/contact.
// The destination address is the CONTACT_TO secret, never in the page or this repo.
import { EmailMessage } from 'cloudflare:email';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Header values must not contain line breaks (header injection) and stay short.
const clean = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function encodeHeader(s) {
  // RFC 2047 encoded-word so non-ASCII subjects survive.
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
}

async function handleContact(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }

  if (data.website) return json({ ok: true }); // honeypot filled: quietly drop bots
  const from = clean(data.from, 200);
  const subject = clean(data.subject, 150);
  const message = String(data.message || '').slice(0, 5000).trim();
  if (!EMAIL.test(from)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!subject || !message) return json({ error: 'Subject and message are required.' }, 400);

  const sender = env.CONTACT_FROM; // e.g. contact@yourdomain, on a domain with Email Routing
  const to = env.CONTACT_TO;       // the verified destination (a Worker secret)
  const body = `From: ${from}\n\n${message}\n`;
  const raw = [
    `From: Website contact <${sender}>`,
    `To: <${to}>`,
    `Reply-To: <${from}>`,
    `Subject: ${encodeHeader('[site] ' + subject)}`,
    `Message-ID: <${crypto.randomUUID()}@${sender.split('@')[1]}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');

  try {
    await env.CONTACT.send(new EmailMessage(sender, to, raw));
  } catch (err) {
    return json({ error: 'Mail service unavailable. Try again later.' }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
