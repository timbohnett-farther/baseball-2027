import { useState, type FormEvent } from "react";
import type { Me } from "@bb/shared";
import { api } from "./api.ts";

export function AuthPanel({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "signup" ? { username, password, displayName } : { username, password };
      onSignedIn(await api<Me>(`/api/auth/${mode}`, { body }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel narrow">
      <div className="toggle">
        <button className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>New player</button>
        <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Sign in</button>
      </div>
      <form className="form" onSubmit={submit}>
        <label>Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        {mode === "signup" && (
          <label>Your name (shown in the game)
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Micah" />
          </label>
        )}
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={6} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{mode === "signup" ? "Create account" : "Sign in"}</button>
        {mode === "signup" && <p className="muted small">Usernames: 3–20 letters, numbers or _. Passwords: 6+ characters.</p>}
      </form>
    </section>
  );
}
