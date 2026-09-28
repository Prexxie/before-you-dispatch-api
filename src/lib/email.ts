import { env } from "../config/env";

type Email = { to: string; subject: string; text: string; html: string };

// EMAIL_FROM is either "name@example.com" or "Display Name <name@example.com>".
function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
}

// Sends over Brevo's HTTPS API (no SDK needed; HTTPS works on hosts that
// block SMTP). Without EMAIL_API_KEY the message is printed instead, so the
// whole reset flow can be tried locally. Throws on a failed send; callers
// decide whether that matters to the user.
export async function sendEmail(email: Email): Promise<void> {
  if (!env.emailApiKey) {
    console.log(
      `\n[email not sent: EMAIL_API_KEY is empty]\nTo: ${email.to}\nSubject: ${email.subject}\n${email.text}\n`,
    );
    return;
  }
  if (!env.emailFrom) {
    throw new Error("EMAIL_FROM must be set (a sender verified in Brevo)");
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.emailApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: parseFrom(env.emailFrom),
      to: [{ email: email.to }],
      subject: email.subject,
      textContent: email.text,
      htmlContent: email.html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Email provider returned ${res.status}: ${await res.text()}`);
  }
}
