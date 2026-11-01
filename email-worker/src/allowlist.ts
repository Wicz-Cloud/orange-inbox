import type { Recipient } from "./route";
import type { Env, ParsedAuthResults } from "./types";

// Local part of the domain mailbox that collects held mail. Admins read it;
// kids never get a membership row on it.
export const HELD_LOCAL_PART = "held";

// A pattern is an exact address ("nana@example.com") or a domain ("@school.org").
export function senderAllowed(from: string, patterns: readonly string[]): boolean {
  const addr = from.trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 1) return false;
  const domain = addr.slice(at);
  return patterns.some((p) => {
    const pat = p.trim().toLowerCase();
    return pat.startsWith("@") ? pat === domain : pat === addr;
  });
}

// A header From that fails DMARC is treated as forged, so it can't borrow an
// allowlisted address. Absent or unknown verdicts are not treated as failures
// (many small senders publish no DMARC).
export function authFailed(auth: ParsedAuthResults | null): boolean {
  return auth?.dmarc === "fail";
}

// Returns where this message should be delivered: the original recipient, or
// the domain's held mailbox when the target mailbox is restricted and the
// sender isn't allowlisted.
export async function resolveHold(
  env: Env,
  recipient: Recipient,
  fromAddr: string,
  auth: ParsedAuthResults | null,
): Promise<Recipient & { held: boolean }> {
  const keep = { ...recipient, held: false };

  const box = await env.DB
    .prepare("SELECT hold_unknown FROM mailboxes WHERE id = ?")
    .bind(recipient.mailboxId)
    .first<{ hold_unknown: number }>();
  if (!box?.hold_unknown) return keep;

  const { results } = await env.DB
    .prepare("SELECT pattern FROM sender_allowlist WHERE mailbox_id = ?")
    .bind(recipient.mailboxId)
    .all<{ pattern: string }>();
  const allowed = senderAllowed(fromAddr, (results ?? []).map((r) => r.pattern));
  if (allowed && !authFailed(auth)) return keep;

  const held = await env.DB
    .prepare("SELECT id FROM mailboxes WHERE domain_id = ? AND local_part = ?")
    .bind(recipient.domainId, HELD_LOCAL_PART)
    .first<{ id: string }>();
  // Fail open if the held mailbox is missing: deliver rather than lose mail.
  if (!held) return keep;
  return { domainId: recipient.domainId, mailboxId: held.id, held: true };
}
