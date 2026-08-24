// Small D1 helpers.

import { genJoinCode } from "./ids";

export async function userExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM users WHERE id = ?").bind(id).first();
  return row != null;
}

/** Generate a join_code that does not already exist in rooms. */
export async function uniqueJoinCode(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genJoinCode();
    const existing = await db
      .prepare("SELECT 1 AS ok FROM rooms WHERE join_code = ?")
      .bind(code)
      .first();
    if (existing == null) return code;
  }
  throw new Error("could not generate a unique join_code");
}
