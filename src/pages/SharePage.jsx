import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function SharePage({ token, currentUser, onImported }) {
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [alreadyImported, setAlreadyImported] = useState(false);
  const [error, setError] = useState("");
  const [importCode, setImportCode] = useState("");
  const [importCodeInput, setImportCodeInput] = useState("");
  const [importCodeError, setImportCodeError] = useState("");
  const [importCodeLoading, setImportCodeLoading] = useState(false);

  useEffect(() => { if (token) fetchTemplate(); else setLoading(false); }, [token]);

  const fetchTemplate = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("templates")
      .select("id, title, description, subject, grade_level, time_limit, question_data, grading_scale, share_password, share_token")
      .eq("share_token", token)
      .eq("share_active", true)
      .single();
    if (error || !data) { setError("Dieser Link ist ungültig oder abgelaufen."); setLoading(false); return; }
    setPasswordRequired(!!data.share_password);
    setTemplate(data);
    // Check if already imported
    if (currentUser) {
      const { data: existing } = await supabase.from("templates")
        .select("id").eq("teacher_id", currentUser.id).eq("title", data.title).limit(1);
      if (existing?.length > 0) setAlreadyImported(true);
    }
    setLoading(false);
  };

  const doImport = async (tmpl) => {
    setImporting(true);
    const { error } = await supabase.from("templates").insert({
      teacher_id: currentUser.id,
      title: tmpl.title,
      description: tmpl.description,
      subject: tmpl.subject,
      grade_level: tmpl.grade_level,
      time_limit: tmpl.time_limit,
      question_data: tmpl.question_data,
      grading_scale: tmpl.grading_scale,
      anti_cheat: false,
    });
    setImporting(false);
    if (error) { setError("Fehler beim Importieren."); return false; }
    return true;
  };

  const handleImport = async () => {
    if (!template || !currentUser || importing || imported) return;
    if (passwordRequired) {
      if (!password) { setPasswordError("Bitte Passwort eingeben."); return; }
      if (password !== template.share_password) { setPasswordError("Falsches Passwort."); return; }
    }
    const ok = await doImport(template);
    if (ok) setImported(true);
  };

  const handleImportByCode = async () => {
    if (!currentUser || !importCodeInput.trim()) return;
    setImportCodeLoading(true);
    setImportCodeError("");
    const { data, error } = await supabase
      .from("templates")
      .select("id, title, description, subject, grade_level, time_limit, question_data, grading_scale, share_password, share_token")
      .eq("share_token", importCodeInput.trim().toLowerCase())
      .eq("share_active", true)
      .single();
    if (error || !data) { setImportCodeError("Ungültiger Code."); setImportCodeLoading(false); return; }
    if (data.share_password) {
      // Show password prompt for this template
      setTemplate(data);
      setPasswordRequired(true);
      setImportCodeLoading(false);
      return;
    }
    const ok = await doImport(data);
    setImportCodeLoading(false);
    if (ok) setImported(true);
  };

  const mins = Math.round((template?.time_limit || 0) / 60);
  const questionCount = (template?.question_data || []).filter(q => q.type !== "section").length;

  // Import by code only (no token in URL)
  if (!token) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "24px", padding: "40px 32px", maxWidth: "440px", width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>📥</div>
        <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Test importieren</h2>
        <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>Gib den Freigabe-Code ein den du von einem anderen Lehrer erhalten hast.</p>
        {imported ? (
          <>
            <div style={{ color: "#16a34a", fontWeight: 700, marginBottom: "20px" }}>✅ Erfolgreich importiert!</div>
            <button onClick={onImported} style={{ width: "100%", padding: "12px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: "pointer" }}>Zur Bibliothek →</button>
          </>
        ) : template && passwordRequired ? (
          // Password prompt after code found
          <>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px", fontSize: "13px", color: "#16a34a", fontWeight: 600 }}>
              ✓ Test gefunden: „{template.title}"
            </div>
            <div style={{ textAlign: "left", marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>🔒 Passwort erforderlich</label>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setPasswordError(""); }}
                placeholder="Passwort eingeben"
                style={{ width: "100%", padding: "10px 14px", border: `2px solid ${passwordError ? "#fca5a5" : "#e5e7eb"}`, borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", boxSizing: "border-box" }} />
              {passwordError && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px" }}>{passwordError}</div>}
            </div>
            <button onClick={async () => {
              if (!password) { setPasswordError("Bitte Passwort eingeben."); return; }
              if (password !== template.share_password) { setPasswordError("Falsches Passwort."); return; }
              const ok = await doImport(template);
              if (ok) setImported(true);
            }} disabled={importing}
              style={{ width: "100%", padding: "13px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer", marginBottom: "10px" }}>
              {importing ? "Wird importiert..." : "📥 Importieren"}
            </button>
            <button onClick={() => { setTemplate(null); setPasswordRequired(false); setPassword(""); }}
              style={{ width: "100%", padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>
              ← Zurück
            </button>
          </>
        ) : (
          <>
            <input value={importCodeInput} onChange={e => { setImportCodeInput(e.target.value); setImportCodeError(""); }}
              placeholder="z.B. a3f8b2c1d4e5f6a7"
              style={{ width: "100%", padding: "12px 14px", border: `2px solid ${importCodeError ? "#fca5a5" : "#e5e7eb"}`, borderRadius: "8px", fontSize: "14px", fontFamily: "monospace", boxSizing: "border-box", marginBottom: "8px" }} />
            {importCodeError && <div style={{ fontSize: "12px", color: "#dc2626", marginBottom: "8px" }}>{importCodeError}</div>}
            <button onClick={handleImportByCode} disabled={importCodeLoading || !currentUser}
              style={{ width: "100%", padding: "13px", background: currentUser ? "#16a34a" : "#e2e8f0", color: currentUser ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer", marginBottom: "12px" }}>
              {importCodeLoading ? "Wird gesucht..." : "Weiter →"}
            </button>
            {!currentUser && <p style={{ fontSize: "12px", color: "#94a3b8" }}>Du musst als Lehrer eingeloggt sein.</p>}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "24px", padding: "40px 32px", maxWidth: "480px", width: "100%", textAlign: "center" }}>
        {loading ? (
          <div style={{ color: "#64748b" }}>Wird geladen...</div>
        ) : error ? (
          <>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>❌</div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Link ungültig</h2>
            <p style={{ color: "#64748b", fontSize: "14px" }}>{error}</p>
          </>
        ) : imported ? (
          <>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>✅</div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Erfolgreich importiert!</h2>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>„{template.title}" ist jetzt in deiner Test-Bibliothek.</p>
            <button onClick={onImported} style={{ width: "100%", padding: "14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>
              Zur Bibliothek →
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>📋</div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#2563a8", letterSpacing: "1px", marginBottom: "8px" }}>TEST-VORLAGE TEILEN</div>
            <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>{template.title}</h2>
            {template.description && <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "12px" }}>{template.description}</p>}
            <div style={{ display: "flex", justifyContent: "center", gap: "16px", fontSize: "13px", color: "#64748b", marginBottom: "24px" }}>
              {template.subject && <span>📚 {template.subject}</span>}
              {template.grade_level && <span>🎓 Klasse {template.grade_level}</span>}
              {questionCount > 0 && <span>📝 {questionCount} Aufgaben</span>}
              {mins > 0 && <span>⏱ {mins} Min.</span>}
            </div>

            {alreadyImported && (
              <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "10px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#92400e" }}>
                ⚠️ Du hast eine Vorlage mit diesem Namen bereits in deiner Bibliothek.
              </div>
            )}

            {!currentUser ? (
              <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "12px", padding: "14px", marginBottom: "20px", fontSize: "13px", color: "#92400e" }}>
                ⚠️ Du musst als Lehrer eingeloggt sein um diese Vorlage zu importieren.
              </div>
            ) : passwordRequired && (
              <div style={{ marginBottom: "20px", textAlign: "left" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>🔒 Passwort erforderlich</label>
                <input type="password" value={password} onChange={e => { setPassword(e.target.value); setPasswordError(""); }}
                  placeholder="Passwort eingeben"
                  style={{ width: "100%", padding: "10px 14px", border: `2px solid ${passwordError ? "#fca5a5" : "#e5e7eb"}`, borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", boxSizing: "border-box" }} />
                {passwordError && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px" }}>{passwordError}</div>}
              </div>
            )}

            <button onClick={handleImport} disabled={importing || !currentUser || imported}
              style={{ width: "100%", padding: "14px", background: currentUser ? "#16a34a" : "#e2e8f0", color: currentUser ? "#fff" : "#94a3b8", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "15px", cursor: currentUser ? "pointer" : "not-allowed" }}>
              {importing ? "Wird importiert..." : "📥 In meine Bibliothek importieren"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
