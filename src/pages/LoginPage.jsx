import { useState } from "react";

const DEMO_TEACHER = { username: "lehrer@quicktest.de", password: "test123", name: "Frau Müller" };
const DEMO_STUDENT = { username: "blauer-adler", password: "1234", name: "Blauer Adler" };

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState("teacher");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (role === "teacher") {
      if (username === DEMO_TEACHER.username && password === DEMO_TEACHER.password) {
        onLogin("teacher", DEMO_TEACHER);
      } else {
        setError("Ungültige Anmeldedaten. Demo: lehrer@quicktest.de / test123");
      }
    } else {
      if (username === DEMO_STUDENT.username && password === DEMO_STUDENT.password) {
        onLogin("student", DEMO_STUDENT);
      } else {
        setError("Ungültiger Benutzername oder PIN. Demo: blauer-adler / 1234");
      }
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1e3a5f 0%, #2563a8 50%, #1e3a5f 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px"
    }}>
      <div style={{ width: "100%", maxWidth: "440px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "10px",
            background: "rgba(255,255,255,0.1)", borderRadius: "16px",
            padding: "12px 24px", backdropFilter: "blur(10px)"
          }}>
            <span style={{ fontSize: "32px" }}>⚡</span>
            <span style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>QuickTest</span>
          </div>
          <p style={{ color: "rgba(255,255,255,0.7)", marginTop: "8px", fontSize: "14px" }}>
            Digitale Tests. Sofort korrigiert.
          </p>
        </div>

        <div style={{ background: "#fff", borderRadius: "20px", padding: "36px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "12px", padding: "4px", marginBottom: "28px" }}>
            {["teacher", "student"].map(r => (
              <button key={r} onClick={() => { setRole(r); setError(""); setUsername(""); setPassword(""); }}
                style={{
                  flex: 1, padding: "10px", border: "none", borderRadius: "9px",
                  fontWeight: 600, fontSize: "14px", cursor: "pointer", transition: "all 0.2s",
                  background: role === r ? "#2563a8" : "transparent",
                  color: role === r ? "#fff" : "#64748b"
                }}>
                {r === "teacher" ? "👨‍🏫 Lehrkraft" : "🎓 Schüler/in"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                {role === "teacher" ? "E-Mail-Adresse" : "Benutzername"}
              </label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder={role === "teacher" ? "name@schule.de" : "z.B. blauer-adler"}
                required
                style={{
                  width: "100%", padding: "12px 14px", border: "2px solid #e5e7eb",
                  borderRadius: "10px", fontSize: "15px", boxSizing: "border-box",
                  outline: "none", fontFamily: "inherit"
                }}
              />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                {role === "teacher" ? "Passwort" : "PIN"}
              </label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={role === "teacher" ? "Passwort eingeben" : "4-stellige PIN"}
                required
                style={{
                  width: "100%", padding: "12px 14px", border: "2px solid #e5e7eb",
                  borderRadius: "10px", fontSize: "15px", boxSizing: "border-box",
                  outline: "none", fontFamily: "inherit"
                }}
              />
            </div>

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px",
                padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#dc2626"
              }}>
                {error}
              </div>
            )}

            <button type="submit" style={{
              width: "100%", padding: "13px", background: "#2563a8", color: "#fff",
              border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 700, cursor: "pointer"
            }}>
              Anmelden
            </button>
          </form>

          {role === "teacher" && (
            <p style={{ textAlign: "center", marginTop: "20px", fontSize: "13px", color: "#6b7280" }}>
              Noch kein Konto?{" "}
              <a href="#" style={{ color: "#2563a8", fontWeight: 600, textDecoration: "none" }}>
                Kostenlos registrieren
              </a>
            </p>
          )}
        </div>

        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: "12px", marginTop: "20px" }}>
          Schüler-Portal: <strong style={{ color: "rgba(255,255,255,0.8)" }}>schüler.quicktest.de</strong>
        </p>
      </div>
    </div>
  );
}
