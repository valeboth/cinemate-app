// Scheduled cleanup: drop data older than the retention window so D1 stays tidy.
// Rooms are ephemeral ("what do we watch tonight"), so 30 days is plenty.
// Runs from the Cron Trigger (see wrangler.toml + the scheduled handler in index.ts).

import type { Env } from "../types";

const RETENTION = "-30 days";

export async function cleanupOldData(env: Env): Promise<void> {
  const oldRooms = `SELECT id FROM rooms WHERE created_at < datetime('now', '${RETENTION}')`;
  // Delete children first (not relying on FK cascade being enabled), then rooms,
  // then orphaned users and their profiles.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM swipes WHERE room_id IN (${oldRooms})`),
    env.DB.prepare(`DELETE FROM matches WHERE room_id IN (${oldRooms})`),
    env.DB.prepare(`DELETE FROM rooms WHERE created_at < datetime('now', '${RETENTION}')`),
    env.DB.prepare(
      `DELETE FROM users WHERE created_at < datetime('now', '${RETENTION}')
         AND id NOT IN (SELECT user_a_id FROM rooms)
         AND id NOT IN (SELECT user_b_id FROM rooms WHERE user_b_id IS NOT NULL)`,
    ),
    env.DB.prepare(`DELETE FROM profiles WHERE user_id NOT IN (SELECT id FROM users)`),
  ]);
}
