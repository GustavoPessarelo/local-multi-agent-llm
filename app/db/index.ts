import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. The optional D1 example is not configured in the local InDev runtime."
    );
  }

  return drizzle(env.DB, { schema });
}
