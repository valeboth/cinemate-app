// ID generators.

/** Unique id for users/rooms (UUID v4). */
export function genId(): string {
  return crypto.randomUUID();
}

// Alphabet without ambiguous characters (no O/0, I/1) for easy-to-read/dictate codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 6-character invite code (default). */
export function genJoinCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}
