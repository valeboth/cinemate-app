// Generatoare de ID-uri.

/** ID unic pentru users/rooms (UUID v4). */
export function genId(): string {
  return crypto.randomUUID();
}

// Alfabet fără caractere ambigue (fără O/0, I/1) pentru coduri ușor de citit/dictat.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Cod de invite de 6 caractere (default). */
export function genJoinCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}
