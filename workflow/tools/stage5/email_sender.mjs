export function emailTransportConfig(env = process.env) {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) return { configured: false, missing, error: `SMTP is not configured. Missing: ${missing.join(", ")}` };
  const portValue = String(env.SMTP_PORT ?? "").trim();
  const port = portValue ? Number(portValue) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { configured: false, missing: [], error: "SMTP_PORT must be an integer between 1 and 65535" };
  const secureValue = String(env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secureValues = new Map([["1", true], ["true", true], ["yes", true], ["on", true], ["0", false], ["false", false], ["no", false], ["off", false]]);
  if (secureValue && !secureValues.has(secureValue)) return { configured: false, missing: [], error: "SMTP_SECURE must be one of: true, false, 1, 0, yes, no, on, off" };
  const from = String(env.SMTP_FROM || env.SMTP_USER).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || from.length > 254) return { configured: false, missing: [], error: "SMTP_FROM (or fallback SMTP_USER) must be a valid email address" };
  return { configured: true, missing: [], error: "", port, secure: secureValue ? secureValues.get(secureValue) : port === 465, from };
}

export async function sendStage5Email(message, { env = process.env, nodemailerLoader = () => import("nodemailer") } = {}) {
  const config = emailTransportConfig(env);
  if (!config.configured) throw Object.assign(new Error(config.error), { category: config.missing.length ? "transport_not_configured" : "smtp_config_invalid" });
  const nodemailer = await nodemailerLoader();
  const transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: config.port, secure: config.secure, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  const result = await transporter.sendMail({ from: config.from, to: message.to, subject: message.subject, html: message.html, text: message.text, attachments: message.attachments.map((item) => ({ filename: item.filename, path: item.path })) });
  return { messageId: String(result?.messageId || "") };
}
