import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("role") === "student" ? "student" : "teacher";
  });
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sebRequired, setSebRequired] = useState(false);
  const [sebChecked, setSebChecked] = useState(false);

  useEffect(() => {
    if (role !== "student") { setSebChecked(true); return; }
    const isSEB = navigator.userAgent.includes("SEB") || navigator.userAgent.includes("SafeExamBrowser");
    if (isSEB) { setSebChecked(true); return; }
    supabase.from("assignments").select("require_seb").eq("status", "aktiv").eq("require_seb", true).limit(1)
      .then(({ data }) => {
        setSebRequired((data || []).length > 0);
        setSebChecked(true);
      });
  }, [role]);

  if (role === "student" && sebChecked && sebRequired) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "24px", padding: "40px 32px", maxWidth: "480px", width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>🔒</div>
        <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Safe Exam Browser erforderlich</h2>
        <p style={{ color: "#64748b", marginBottom: "28px", fontSize: "14px", lineHeight: 1.6 }}>
          Dieser Test kann nur mit dem <strong>Safe Exam Browser (SEB)</strong> geöffnet werden. SEB verhindert Autokorrektur, Tab-Wechsel und andere Apps während der Prüfung.
        </p>

        {/* Schritt 1 */}
        <div style={{ background: "#f0f7ff", borderRadius: "14px", padding: "18px 20px", marginBottom: "14px", textAlign: "left", border: "1px solid #bfdbfe" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#1e40af", marginBottom: "10px" }}>Schritt 1 — Safe Exam Browser installieren</div>
          <p style={{ fontSize: "13px", color: "#374151", margin: "0 0 12px", lineHeight: 1.5 }}>
            Installiere die kostenlose SEB-App auf deinem Gerät (nur einmalig nötig):
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <a href="https://apps.apple.com/app/safe-exam-browser/id1587573560" target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: "#000", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>
              🍎 App Store (iPhone/iPad)
            </a>
            <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: "#0078d4", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>
              🪟 Windows / macOS
            </a>
          </div>
        </div>

        {/* Schritt 2 */}
        <div style={{ background: "#f5f3ff", borderRadius: "14px", padding: "18px 20px", marginBottom: "20px", textAlign: "left", border: "1px solid #e9d5ff" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#6d28d9", marginBottom: "10px" }}>Schritt 2 — Safe Exam Browser starten</div>
          <p style={{ fontSize: "13px", color: "#374151", margin: "0 0 14px", lineHeight: 1.5 }}>
            Klicke auf den Button unten. SEB öffnet sich automatisch und du kannst dich einloggen.
          </p>
          <a href="seb://quicktest.lovable.app?role=student"
            style={{ display: "block", width: "100%", padding: "14px", background: "#7c3aed", color: "#fff", borderRadius: "10px", fontWeight: 700, fontSize: "15px", textDecoration: "none", boxSizing: "border-box", textAlign: "center" }}>
            🔒 Safe Exam Browser starten
          </a>
        </div>

        <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0, lineHeight: 1.5 }}>
          Der Button funktioniert nur wenn SEB bereits installiert ist. Installiere zuerst die App aus Schritt 1.
        </p>
      </div>
    </div>
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (role === "teacher") {
        if (isRegister) {
          const { error } = await supabase.auth.signUp({
            email: username, password,
            options: { data: { name } }
          });
          if (error) { setError(error.message); return; }
          setIsRegister(false);
          setError("Registrierung erfolgreich! Bitte jetzt einloggen.");
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email: username, password });
        if (error) { setError("E-Mail oder Passwort falsch."); return; }
        // App.tsx handles redirect via onAuthStateChange
      } else {
        const { data, error } = await supabase
          .from("students")
          .select("*, groups(name, subject)")
          .ilike("username", username.trim())
          .eq("pin", password.trim())
          .single();
        if (error || !data) { setError("Ungültiger Benutzername oder PIN."); return; }
        onLogin("student", data);
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "12px 14px", border: "2px solid #e5e7eb",
    borderRadius: "10px", fontSize: "15px", boxSizing: "border-box",
    outline: "none", fontFamily: "inherit"
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1e3a5f 0%, #2563a8 50%, #1e3a5f 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "440px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "12px 24px" }}>
            <span style={{ fontSize: "32px" }}>⚡</span>
            <span style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>QuickTest</span>
          </div>
          <p style={{ color: "rgba(255,255,255,0.7)", marginTop: "8px", fontSize: "14px" }}>Digitale Tests. Sofort korrigiert.</p>
        </div>

        <div style={{ background: "#fff", borderRadius: "20px", padding: "36px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "12px", padding: "4px", marginBottom: "24px" }}>
            {["teacher", "student"].map(r => (
              <button key={r} onClick={() => { setRole(r); setError(""); setUsername(""); setPassword(""); setIsRegister(false); }}
                style={{ flex: 1, padding: "10px", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "14px", cursor: "pointer", transition: "all 0.2s", background: role === r ? "#2563a8" : "transparent", color: role === r ? "#fff" : "#64748b" }}>
                {r === "teacher" ? "👨‍🏫 Lehrkraft" : "🎓 Schüler/in"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {role === "teacher" && isRegister && (
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Vollständiger Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Maria Müller" required style={inputStyle} />
              </div>
            )}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                {role === "teacher" ? "E-Mail-Adresse" : "Benutzername"}
              </label>
              <input type={role === "teacher" ? "email" : "text"} value={username} onChange={e => setUsername(e.target.value)}
                placeholder={role === "teacher" ? "name@schule.de" : "z.B. blauer-Adler"} required style={inputStyle}
                autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck="false" />
            </div>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                {role === "teacher" ? "Passwort" : "PIN"}
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={role === "teacher" ? "Mind. 6 Zeichen" : "PIN eingeben"} required style={inputStyle} />
            </div>

            {error && (
              <div style={{ background: error.includes("erfolgreich") ? "#dcfce7" : "#fef2f2", border: `1px solid ${error.includes("erfolgreich") ? "#bbf7d0" : "#fecaca"}`, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: error.includes("erfolgreich") ? "#16a34a" : "#dc2626" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{ width: "100%", padding: "13px", background: loading ? "#93c5fd" : "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Bitte warten..." : isRegister ? "Konto erstellen" : "Anmelden"}
            </button>
          </form>

          {role === "teacher" && (
            <p style={{ textAlign: "center", marginTop: "20px", fontSize: "13px", color: "#6b7280" }}>
              {isRegister ? "Schon ein Konto? " : "Noch kein Konto? "}
              <button onClick={() => { setIsRegister(!isRegister); setError(""); }} style={{ background: "none", border: "none", color: "#2563a8", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                {isRegister ? "Einloggen" : "Kostenlos registrieren"}
              </button>
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
