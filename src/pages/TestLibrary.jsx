import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const SUBJECT_COLORS = {
  "Mathematik": { bg: "#eff6ff", color: "#2563a8", border: "#bfdbfe" },
  "Deutsch":    { bg: "#fdf4ff", color: "#7c3aed", border: "#e9d5ff" },
  "Englisch":   { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
  "Sachkunde":  { bg: "#fff7ed", color: "#ea580c", border: "#fed7aa" },
  "Geschichte": { bg: "#fefce8", color: "#ca8a04", border: "#fde68a" },
};
const defaultColor = { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" };
const getSubjectColor = (subject) => SUBJECT_COLORS[subject] || defaultColor;

export default function TestLibrary({ navigate, onLogout, currentUser }) {
  const [templates, setTemplates] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterGradeLevel, setFilterGradeLevel] = useState("");
  const [assignModal, setAssignModal] = useState(null);
  const [assignGroupId, setAssignGroupId] = useState("");
  const [assignTimeLimit, setAssignTimeLimit] = useState(20);
  const [assignAntiCheat, setAssignAntiCheat] = useState(true);
  const [assignRequireSeb, setAssignRequireSeb] = useState(true);
  const [assignGradingScale, setAssignGradingScale] = useState([
    { grade: "1", minPercent: 87 }, { grade: "2", minPercent: 73 },
    { grade: "3", minPercent: 59 }, { grade: "4", minPercent: 45 },
    { grade: "5", minPercent: 18 }, { grade: "6", minPercent: 0 },
  ]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [shareModal, setShareModal] = useState(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [copiedWhat, setCopiedWhat] = useState("");
  const [assigning, setAssigning] = useState(false);

  const copyWithFeedback = (text, what) => {
    navigator.clipboard.writeText(text);
    setCopiedWhat(what);
    setTimeout(() => setCopiedWhat(""), 2000);
  };

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: tmpl }, { data: grps }] = await Promise.all([
      supabase.from("templates").select("*").eq("teacher_id", currentUser?.id).order("created_at", { ascending: false }),
      supabase.from("groups").select("*"),
    ]);
    setTemplates(tmpl || []);
    setGroups(grps || []);
    setLoading(false);
  };

  const generateShareLink = async () => {
    if (!shareModal) return;
    const token = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
    const { error } = await supabase.from("templates").update({
      share_token: token,
      share_password: sharePassword || null,
      share_active: true,
    }).eq("id", shareModal.id);
    if (!error) {
      const link = `https://quickest.lovable.app/share/${token}`;
      setShareLink(link);
      setTemplates(prev => prev.map(t => t.id === shareModal.id ? { ...t, share_token: token, share_active: true } : t));
    }
  };

  const deactivateShareLink = async () => {
    if (!shareModal) return;
    await supabase.from("templates").update({ share_active: false }).eq("id", shareModal.id);
    setShareLink("");
    setTemplates(prev => prev.map(t => t.id === shareModal.id ? { ...t, share_active: false } : t));
    setShareModal(prev => ({ ...prev, share_active: false }));
  };

  const handleAssign = async () => {
    if (!assignGroupId) return;
    setAssigning(true);
    await supabase.from("assignments").insert({
      template_id: assignModal.id,
      group_id: Number(assignGroupId),
      teacher_id: currentUser?.id,
      title: assignModal.title,
      status: "aktiv",
      time_limit: assignTimeLimit * 60,
      timing_mode: "lobby",
      anti_cheat: assignAntiCheat,
      require_seb: assignRequireSeb,
      question_data: assignModal.question_data,
      grading_scale: assignGradingScale,
    });
    setAssigning(false);
    setAssignModal(null);
    navigate("dashboard");
  };

  const deleteTemplate = async (id) => {
    await supabase.from("templates").delete().eq("id", id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    setDeleteConfirm(null);
  };

  const subjects = [...new Set(templates.map(t => t.subject).filter(Boolean))];
  const filtered = templates.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) &&
    (!filterSubject || t.subject === filterSubject) &&
    (!filterGradeLevel || t.grade_level === filterGradeLevel)
  );

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="library">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Test-Vorlagen</h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>Erstelle wiederverwendbare Tests und weise sie beliebigen Lerngruppen zu.</p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => navigate("share")} style={{ padding: "10px 16px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>📥 Test per Share-Code importieren</button>
            <button onClick={() => navigate("testEditor", null)} style={{ padding: "10px 20px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>✏️ Neue Vorlage</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Vorlagen durchsuchen..."
            style={{ flex: 1, padding: "10px 14px", border: "2px solid #e5e7eb", borderRadius: "10px", fontSize: "14px", fontFamily: "inherit", outline: "none" }} />
          <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}
            style={{ padding: "10px 14px", border: "2px solid #e5e7eb", borderRadius: "10px", fontSize: "14px", fontFamily: "inherit", background: "#fff" }}>
            <option value="">Alle Fächer</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterGradeLevel} onChange={e => setFilterGradeLevel(e.target.value)}
            style={{ padding: "10px 14px", border: "2px solid #e5e7eb", borderRadius: "10px", fontSize: "14px", fontFamily: "inherit", background: "#fff" }}>
            <option value="">Alle Klassen</option>
            {[5,6,7,8,9,10,11,12,13].map(g => <option key={g} value={String(g)}>{g}. Klasse</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : filtered.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "56px", textAlign: "center", border: "1px solid #e2e8f0", color: "#94a3b8" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>📚</div>
            <div style={{ fontWeight: 600, fontSize: "16px", color: "#374151" }}>{templates.length === 0 ? "Noch keine Vorlagen vorhanden" : "Keine Vorlagen gefunden"}</div>
            {templates.length === 0 && (
              <button onClick={() => navigate("testEditor", null)} style={{ marginTop: "20px", padding: "10px 24px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
                ✏️ Erste Vorlage erstellen
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            {filtered.map(template => {
              const sc = getSubjectColor(template.subject);
              const mins = Math.round((template.time_limit || 0) / 60);
              const taskCount = (template.question_data || []).reduce((sum, q) => {
                if (q.type === "section") return sum + (q.tasks || []).length;
                if (q.type === "task") return sum + 1;
                return sum;
              }, 0);
              return (
                <div key={template.id} style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "20px 20px 14px", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      {template.subject && (
                        <span style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 }}>{template.subject}</span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a", marginBottom: "8px" }}>{template.title}</div>
                    {template.description && <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>{template.description}</div>}
                    <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#94a3b8" }}>
                      {taskCount > 0 && <span>📋 {taskCount} Aufgabe{taskCount !== 1 ? "n" : ""}</span>}
                      {mins > 0 && <span>⏱ {mins} Min.</span>}
                      {template.grade_level && <span>🎓 Klasse {template.grade_level}</span>}
                      {template.anti_cheat && <span>🛡️ Anti-Cheat</span>}
                    </div>
                  </div>
                  <div style={{ padding: "12px 20px", borderTop: "1px solid #f1f5f9", display: "flex", gap: "8px" }}>
                    <button onClick={() => {
                      setAssignModal(template);
                      setAssignGroupId("");
                      setAssignTimeLimit(Math.round((template.time_limit || 1200) / 60));
                      setAssignAntiCheat(template.anti_cheat || true);
                      setAssignRequireSeb(true);
                      setAssignGradingScale(template.grading_scale?.length ? template.grading_scale : [
                        { grade: "1", minPercent: 87 }, { grade: "2", minPercent: 73 },
                        { grade: "3", minPercent: 59 }, { grade: "4", minPercent: 45 },
                        { grade: "5", minPercent: 18 }, { grade: "6", minPercent: 0 },
                      ]);
                    }} style={{ flex: 1, padding: "8px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                      👥 Zuweisen
                    </button>
                    <button onClick={() => navigate("testEditor", template)} style={{ padding: "8px 12px", background: "#f8fafc", color: "#374151", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>✏️</button>
                    <button onClick={() => {
                      setShareModal(template);
                      setSharePassword("");
                      setShareLink(template.share_token && template.share_active ? `https://quickest.lovable.app/share/${template.share_token}` : "");
                    }} style={{ padding: "8px 12px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>🔗</button>
                    <button onClick={() => setDeleteConfirm(template.id)} style={{ padding: "8px 12px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ZUWEISUNG MODAL */}
      {assignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "460px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px", textAlign: "center" }}>👥</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px", textAlign: "center" }}>Test zuweisen</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px", textAlign: "center" }}>„{assignModal.title}"</p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Lerngruppe wählen *</label>
              {groups.length === 0 ? (
                <div style={{ background: "#fef9c3", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#92400e" }}>
                  ⚠️ Noch keine Lerngruppen.{" "}
                  <button onClick={() => { setAssignModal(null); navigate("groups"); }} style={{ background: "none", border: "none", color: "#2563a8", cursor: "pointer", fontWeight: 600, fontSize: "13px" }}>Jetzt anlegen →</button>
                </div>
              ) : (
                <select value={assignGroupId} onChange={e => setAssignGroupId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                  <option value="">– Gruppe auswählen –</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} {g.subject ? `(${g.subject})` : ""} · {g.count} Schüler/innen</option>)}
                </select>
              )}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Bearbeitungszeit (Min.)</label>
              <input type="number" min={1} max={180} value={assignTimeLimit} onChange={e => setAssignTimeLimit(Number(e.target.value))}
                style={{ width: "160px", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" checked={assignAntiCheat} onChange={e => setAssignAntiCheat(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
                🛡️ Anti-Cheat aktivieren (Tab-Wechsel loggen)
              </label>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" checked={assignRequireSeb} onChange={e => setAssignRequireSeb(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#7c3aed", marginTop: "1px", flexShrink: 0 }} />
                <div>
                  🔒 Safe Exam Browser erforderlich
                  <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 400, marginTop: "2px" }}>
                    Schüler müssen die SEB-App nutzen. Verhindert Autokorrektur, Tab-Wechsel und andere Apps.
                  </div>
                </div>
              </label>
              {assignRequireSeb && (
                <div style={{ marginTop: "10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "12px 14px", fontSize: "13px", color: "#92400e", lineHeight: 1.5 }}>
                  <strong>⚠️ Hinweis für Android-Geräte:</strong> Safe Exam Browser ist für Android nicht verfügbar.
                </div>
              )}
            </div>

            <details style={{ marginBottom: "24px" }}>
              <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", userSelect: "none" }}>📊 Notenschlüssel anpassen</summary>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                {assignGradingScale.map((g, i) => (
                  <div key={i} style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid #e2e8f0", fontSize: "13px" }}>
                    <strong>Note {g.grade}</strong> ab{" "}
                    <input type="number" value={g.minPercent} min={0} max={100}
                      onChange={e => { const u = [...assignGradingScale]; u[i] = { ...u[i], minPercent: Number(e.target.value) }; setAssignGradingScale(u); }}
                      style={{ width: "48px", border: "none", background: "none", fontWeight: 700, fontSize: "13px", color: "#2563a8" }} />%
                  </div>
                ))}
              </div>
            </details>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setAssignModal(null)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={handleAssign} disabled={!assignGroupId || assigning}
                style={{ flex: 1, padding: "11px", background: (assignGroupId && !assigning) ? "#2563a8" : "#e2e8f0", color: (assignGroupId && !assigning) ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", fontWeight: 700, cursor: (assignGroupId && !assigning) ? "pointer" : "not-allowed" }}>
                {assigning ? "Wird gespeichert..." : "Test aktivieren →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARE MODAL */}
      {shareModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "460px", width: "100%" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px" }}>🔗 Test teilen</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>„{shareModal.title}"</p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Passwort (optional)</label>
              <input type="text" value={sharePassword} onChange={e => setSharePassword(e.target.value)}
                placeholder="Leer lassen für öffentlichen Link"
                style={{ width: "100%", padding: "10px 14px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", boxSizing: "border-box" }} />
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>Empfänger brauchen dieses Passwort zum Importieren.</div>
            </div>

            <button onClick={generateShareLink}
              style={{ width: "100%", padding: "12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer", marginBottom: "16px" }}>
              🔗 {shareModal.share_active ? "Neuen Link generieren" : "Link generieren"}
            </button>

            {(shareLink || shareModal.share_active) && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "14px", marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#16a34a", marginBottom: "8px" }}>✅ Link aktiv:</div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                  <input readOnly value={shareLink || `https://quickest.lovable.app/share/${shareModal.share_token}`}
                    style={{ flex: 1, padding: "8px 10px", border: "1px solid #bbf7d0", borderRadius: "6px", fontSize: "12px", background: "#fff", fontFamily: "monospace", color: "#374151" }} />
                  <button onClick={() => copyWithFeedback(shareLink || `https://quickest.lovable.app/share/${shareModal.share_token}`, "link")}
                    style={{ padding: "8px 12px", background: copiedWhat === "link" ? "#16a34a" : "#2563a8", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                    {copiedWhat === "link" ? "✓ Kopiert!" : "Kopieren"}
                  </button>
                </div>
                <div style={{ background: "#f0f7ff", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px", fontSize: "12px", color: "#1e40af" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <strong>Freigabe-Code:</strong>
                    <button onClick={() => copyWithFeedback(shareModal.share_token, "code")}
                      style={{ padding: "4px 10px", background: copiedWhat === "code" ? "#16a34a" : "#2563a8", color: "#fff", border: "none", borderRadius: "5px", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>
                      {copiedWhat === "code" ? "✓ Kopiert!" : "Kopieren"}
                    </button>
                  </div>
                  <span style={{ fontFamily: "monospace", letterSpacing: "1px", fontSize: "13px" }}>{shareModal.share_token}</span>
                  <div style={{ color: "#64748b", marginTop: "4px" }}>Lehrer können diesen Code auch direkt in ihrer Bibliothek eingeben.</div>
                </div>
                <button onClick={deactivateShareLink}
                  style={{ width: "100%", padding: "8px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                  🔗 Teilen deaktivieren
                </button>
              </div>
            )}

            <button onClick={() => { setShareModal(null); setShareLink(""); setSharePassword(""); }}
              style={{ width: "100%", padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "360px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px" }}>Vorlage löschen?</h3>
            <p style={{ color: "#64748b", marginBottom: "8px", fontSize: "14px" }}>„{templates.find(t => t.id === deleteConfirm)?.title}"</p>
            <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "12px" }}>Bereits zugewiesene Tests bleiben erhalten.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={() => deleteTemplate(deleteConfirm)} style={{ flex: 1, padding: "10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>Löschen</button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
