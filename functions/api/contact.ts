// Pilot-request contact form handler.
// Replaces the FastAPI /api/contact route that previously ran on Hostinger
// (app/routes/contact.py in automatizari-cc/docvault). Behavior preserved:
// Pydantic-equivalent validation, CRLF strip, honeypot, Turnstile siteverify,
// email send. SMTP → Resend HTTP API is the only material change.

interface Env {
  TURNSTILE_SECRET: string;
  RESEND_API_KEY: string;
}

interface ContactPayload {
  name?: string;
  company?: string;
  email?: string;
  usecase?: string;
  message?: string;
  website?: string;
  "cf-turnstile-response"?: string;
}

const MAX = { name: 120, company: 120, email: 254, usecase: 80, message: 2000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// _headers / api/* doesn't reach Pages Function responses, so apply the
// security headers explicitly on every Response built here.
const RESP_HEADERS: HeadersInit = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "access-control-allow-origin": "https://docvault.tech",
  "x-content-type-options": "nosniff",
};

function bad(detail: string, status = 400): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: RESP_HEADERS,
  });
}

function stripControl(v: unknown, max: number, fieldName: string): string {
  if (typeof v !== "string") throw new Error(`${fieldName}: required`);
  if (/[\r\n]/.test(v)) throw new Error(`${fieldName}: invalid characters`);
  const s = v.trim();
  if (s.length < 1 || s.length > max) throw new Error(`${fieldName}: length`);
  return s;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: ContactPayload;
  try {
    payload = await request.json();
  } catch {
    return bad("invalid json");
  }

  // Honeypot — silently 200, no further work.
  if (payload.website && payload.website.length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: RESP_HEADERS,
    });
  }

  let name: string, company: string, usecase: string, email: string;
  let message = "";
  try {
    name = stripControl(payload.name, MAX.name, "name");
    company = stripControl(payload.company, MAX.company, "company");
    usecase = stripControl(payload.usecase, MAX.usecase, "usecase");
    email = stripControl(payload.email, MAX.email, "email");
    if (!EMAIL_RE.test(email)) throw new Error("email: invalid");
    if (payload.message != null) {
      const m = String(payload.message);
      if (/[\r\n]/.test(m)) throw new Error("message: invalid characters");
      if (m.length > MAX.message) throw new Error("message: length");
      message = m.trim();
    }
  } catch (e) {
    return bad((e as Error).message);
  }

  const token = payload["cf-turnstile-response"];
  if (!token || typeof token !== "string") {
    return bad("Verification missing");
  }

  // Turnstile siteverify
  const clientIp = request.headers.get("cf-connecting-ip") ?? "";
  let verify: Response;
  try {
    verify = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: clientIp,
        }),
      },
    );
  } catch {
    return bad("Verification unavailable", 502);
  }
  const verifyJson = (await verify.json()) as { success?: boolean };
  if (!verifyJson.success) return bad("Verification failed");

  // Send via Resend
  const subject = `[Service request] ${company} — ${usecase}`;
  const body =
    `New service request from the landing page.\n\n` +
    `Name:     ${name}\n` +
    `Company:  ${company}\n` +
    `Email:    ${email}\n` +
    `Use case: ${usecase}\n\n` +
    `Message:\n${message || "(none)"}\n`;

  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "DocVault Site <keeper@docvault.tech>",
      to: ["keeper@docvault.tech"],
      reply_to: email,
      subject,
      text: body,
    }),
  });

  if (!send.ok) return bad("Could not send message", 502);

  return new Response(JSON.stringify({ ok: true }), {
    headers: RESP_HEADERS,
  });
};
