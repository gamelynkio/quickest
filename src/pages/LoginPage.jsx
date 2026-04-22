import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("role") === "student" ? "student" : "teacher";
  });
  const [isRegister, setIsRegister] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [sebRequired, setSebRequired] = useState(false);
  const [sebChecked, setSebChecked] = useState(false);
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

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

  if (role === "student" && !sebChecked) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: "36px", marginBottom: "12px" }}>⚡</div>
        <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)" }}>Wird geladen...</div>
      </div>
    </div>
  );

  if (role === "student" && sebChecked && sebRequired) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "24px", padding: "40px 32px", maxWidth: "480px", width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>🔒</div>
        <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Safe Exam Browser erforderlich</h2>
        <p style={{ color: "#64748b", marginBottom: "28px", fontSize: "14px", lineHeight: 1.6 }}>
          Dieser Test kann nur mit dem <strong>Safe Exam Browser (SEB)</strong> geöffnet werden.
        </p>
        <div style={{ background: "#f0f7ff", borderRadius: "14px", padding: "18px 20px", marginBottom: "14px", textAlign: "left", border: "1px solid #bfdbfe" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#1e40af", marginBottom: "10px" }}>Schritt 1 — Safe Exam Browser installieren</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <a href="https://apps.apple.com/us/app/safeexambrowser/id1155002964" target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: "#000", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>
              🍎 App Store
            </a>
            <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: "#0078d4", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>
              🪟 Windows / macOS
            </a>
          </div>
        </div>
        <div style={{ background: "#f5f3ff", borderRadius: "14px", padding: "18px 20px", marginBottom: "20px", textAlign: "left", border: "1px solid #e9d5ff" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: "#6d28d9", marginBottom: "10px" }}>Schritt 2 — Safe Exam Browser starten</div>
          <a href="sebs://quickest.lovable.app/?role=student"
            style={{ display: "block", width: "100%", padding: "14px", background: "#7c3aed", color: "#fff", borderRadius: "10px", fontWeight: 700, fontSize: "15px", textDecoration: "none", boxSizing: "border-box", textAlign: "center" }}>
            🔒 Safe Exam Browser starten
          </a>
        </div>
      </div>
    </div>
  );

  const handleResendConfirmation = async () => {
    setResendLoading(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: username });
    setResendLoading(false);
    if (!error) setResendSuccess(true);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!username.trim()) { setError("Bitte gib deine E-Mail-Adresse ein."); return; }
    setLoading(true); setError(""); setSuccess("");
    const { error } = await supabase.auth.resetPasswordForEmail(username.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError("Fehler beim Senden der E-Mail. Bitte überprüfe die Adresse.");
    } else {
      setSuccess("✓ Falls diese E-Mail-Adresse registriert ist, erhältst du in Kürze einen Link zum Zurücksetzen des Passworts.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setEmailNotConfirmed(false); setResendSuccess(false); setLoading(true);
    try {
      if (role === "teacher") {
        if (isRegister) {
          const { data, error } = await supabase.auth.signUp({
            email: username, password,
            options: { data: { name } }
          });
          if (error) {
            if (error.message.includes("already registered") || error.message.includes("already been registered") || error.message.includes("User already registered")) {
              setError("Diese E-Mail-Adresse ist bereits registriert. Bitte melde dich direkt an oder setze dein Passwort zurück.");
            } else if (error.message.includes("Password should be")) {
              setError("Das Passwort muss mindestens 6 Zeichen lang sein.");
            } else if (error.message.includes("Invalid email")) {
              setError("Bitte gib eine gültige E-Mail-Adresse ein.");
            } else {
              setError(`Registrierung fehlgeschlagen: ${error.message}`);
            }
            return;
          }
          // Supabase gibt bei bereits existierender E-Mail manchmal kein error zurück
          // aber identities ist leer
          if (!data?.session && (!data?.user?.identities || data.user.identities.length === 0)) {
            setError("Diese E-Mail-Adresse ist bereits registriert. Bitte melde dich direkt an oder setze dein Passwort zurück.");
            return;
          }
          setIsRegister(false);
          setSuccess("✓ Registrierung erfolgreich! Du kannst dich jetzt anmelden.");
          return;
        }

        const { error } = await supabase.auth.signInWithPassword({ email: username, password });
        if (error) {
          if (error.message.includes("Email not confirmed") || error.message.includes("email_not_confirmed")) {
            setEmailNotConfirmed(true);
          } else if (error.message.includes("Invalid login credentials") || error.message.includes("invalid_credentials")) {
            setError("E-Mail oder Passwort falsch. Falls du dein Passwort vergessen hast, klicke auf „Passwort vergessen".");
          } else {
            setError(`Anmeldung fehlgeschlagen: ${error.message}`);
          }
          return;
        }
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

          {/* Passwort vergessen */}
          {isForgotPassword ? (
            <>
              <button onClick={() => { setIsForgotPassword(false); setError(""); setSuccess(""); }}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", marginBottom: "16px", padding: 0, display: "flex", alignItems: "center", gap: "4px" }}>
                ← Zurück
              </button>
              <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>Passwort zurücksetzen</h3>
              <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "20px" }}>
                Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link zum Zurücksetzen.
              </p>
              <form onSubmit={handleForgotPassword}>
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>E-Mail-Adresse</label>
                  <input type="email" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="name@schule.de" required style={inputStyle} autoCapitalize="none" />
                </div>
                {error && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
                    {error}
                  </div>
                )}
                {success && (
                  <div style={{ background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#16a34a" }}>
                    {success}
                  </div>
                )}
                <button type="submit" disabled={loading} style={{ width: "100%", padding: "13px", background: loading ? "#93c5fd" : "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
                  {loading ? "Wird gesendet..." : "Link zusenden"}
                </button>
              </form>
            </>
          ) : (
            <>
              <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "12px", padding: "4px", marginBottom: "24px" }}>
                {["teacher", "student"].map(r => (
                  <button key={r} onClick={() => { setRole(r); setError(""); setSuccess(""); setUsername(""); setPassword(""); setIsRegister(false); setIsForgotPassword(false); }}
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
                <div style={{ marginBottom: "8px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                    {role === "teacher" ? "Passwort" : "PIN"}
                  </label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder={role === "teacher" ? "Mind. 6 Zeichen" : "PIN eingeben"} required style={inputStyle} />
                </div>

                {/* Passwort vergessen Link */}
                {role === "teacher" && !isRegister && (
                  <div style={{ textAlign: "right", marginBottom: "16px" }}>
                    <button type="button" onClick={() => { setIsForgotPassword(true); setError(""); setSuccess(""); }}
                      style={{ background: "none", border: "none", color: "#2563a8", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>
                      Passwort vergessen?
                    </button>
                  </div>
                )}

                {emailNotConfirmed && (
                  <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 14px", marginBottom: "16px", fontSize: "13px", color: "#92400e" }}>
                    <div style={{ fontWeight: 700, marginBottom: "6px" }}>📧 E-Mail nicht bestätigt</div>
                    <div style={{ marginBottom: "10px" }}>Klicke auf den Bestätigungslink in der E-Mail die wir dir geschickt haben.</div>
                    {resendSuccess ? (
                      <div style={{ color: "#16a34a", fontWeight: 600 }}>✓ E-Mail wurde erneut gesendet!</div>
                    ) : (
                      <button type="button" onClick={handleResendConfirmation} disabled={resendLoading}
                        style={{ background: "#92400e", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                        {resendLoading ? "Wird gesendet..." : "Bestätigungsmail erneut senden"}
                      </button>
                    )}
                  </div>
                )}

                {error && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#dc2626", lineHeight: 1.5 }}>
                    {error}
                    {error.includes("bereits registriert") && (
                      <div style={{ marginTop: "8px" }}>
                        <button type="button" onClick={() => { setIsRegister(false); setError(""); }}
                          style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", padding: "5px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer", marginRight: "6px" }}>
                          Jetzt anmelden
                        </button>
                        <button type="button" onClick={() => { setIsForgotPassword(true); setError(""); }}
                          style={{ background: "none", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "6px", padding: "5px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                          Passwort vergessen?
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {success && (
                  <div style={{ background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#16a34a" }}>
                    {success}
                  </div>
                )}

                <button type="submit" disabled={loading} style={{ width: "100%", padding: "13px", background: loading ? "#93c5fd" : "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
                  {loading ? "Bitte warten..." : isRegister ? "Konto erstellen" : "Anmelden"}
                </button>
              </form>

              {role === "teacher" && (
                <p style={{ textAlign: "center", marginTop: "20px", fontSize: "13px", color: "#6b7280" }}>
                  {isRegister ? "Schon ein Konto? " : "Noch kein Konto? "}
                  <button onClick={() => { setIsRegister(!isRegister); setError(""); setSuccess(""); }}
                    style={{ background: "none", border: "none", color: "#2563a8", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                    {isRegister ? "Einloggen" : "Kostenlos registrieren"}
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
