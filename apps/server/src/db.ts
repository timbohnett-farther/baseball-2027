import postgres from "postgres";

// Railway injects DATABASE_URL from the Postgres service. Locally it's optional for now.
export const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { max: 5 }) : null;

export async function databaseStatus(): Promise<"connected" | "not configured" | "error"> {
  if (!sql) return "not configured";
  try {
    await sql`select 1`;
    return "connected";
  } catch {
    return "error";
  }
}
