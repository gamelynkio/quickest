import { useState } from "react";
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

export default function TestLibrary({ navigate, onLogout, currentUser, templates, setTemplates, groups, tests, setTests }) {
  const [search, setSearch] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [assignModal, setAssignModal] = useState(null);
  const [assignGroupId, setAssignGroupId] = useState("");
  const [assignTimeLimit, setAssignTimeLimit] = useState(20);
  const [assignTimingMode, setAssignTimingMode] = useState("countdown");
  const [assignAntiCheat, setAssignAntiCheat] = useState(false);
  const [assignDate, setAssignDate] = useState("");
  const [assignTimeStart, setAssignTimeStart] = useState("08:00");
  const [assignTimeEnd, setAssignTimeEnd] = useState("10:00");
  const [assignTimezone, setAssignTimezone] = useState("Europe/Berlin");
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const subjects = [...new Set(templates.map(t => t.subject).filter(Boolean))];

  const filtered = templates.filter(t => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase());
    const matchSubject = !filterSubject || t.subject === filterSubject;
    return matchSearch && matchSubject;
  });

  const windowValid = assignTimingMode !== "window" || (assignDate && assignTimeStart && assignTimeEnd);

  const handleAssign = () => {
    if (!assignGroupId || !windowValid) return;
    const group = groups.find(g => g.id === Number(assignGroupId));
    const newTest = {
      id: Date.now(),
      title: assignModal.title,
      description: assignModal.description,
      groupId: Number(assignGroupId),
      timeLimit: assignTimeLimit * 60,
      timingMode: assignTimingMode,
      antiCheat: assignAntiCheat,
      ...(assignTimingMode === "window" && {
        windowDate: assignDate,
        windowStart: assignTimeStart,
        windowEnd: assignTimeEnd,
        windowTimezone: assignTimezone,
      }),
      questionData: assignModal.questionData,
      gradingScale: assignModal.gradingScale,
      status: "aktiv",
      submissions: 0,
      total: group?.count || 0,
      avgScore: null,
      questions: assignModal.questions,
      templateId: assignModal.id,
    };
    setTests(prev => [...prev, newTest]);
    setAssignModal(null);
    setAssignGroupId("");
    navigate("dashboard");
  };

  const deleteTemplate = (id) => {
    setTemplates(prev => prev.filter(t => t.id !== id));
    setDeleteConfirm(null);
  };

  const getAssignCount = (templateId) => tests.filter(t => t.templateId === templateId).length;

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="library">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Test-Vorlagen</h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
              Erstelle wiederverwendbare Tests und weise sie beliebigen Lerngruppen zu.
            </p>
          </div>
          <button onClick={() => navigate("testEditor", null)} style={{
            padding: "10px 20px", background: "#2563a8", color: "#fff",
            border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
          }}>✏️ Neue Vorlage erstellen</button>
        </div>

        {/* Search & Filter */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Vorlagen durchsuchen..."
            style={{ flex: 1, padding: "10px 14px", border: "2px solid #e5e7eb", borderRadius: "10px", fontSize: "14px", fontFamily: "inherit", outline: "none" }} />
          <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}
            style={{ padding: "10px 14px", border: "2px solid #e5e7eb", borderRadius: "10px", fontSize: "14px", fontFamily: "inherit", background: "#fff", minWidth: "160px" }}>
            <option value="">Alle Fächer</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Empty State */}
        {filtered.length === 0 && (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "56px", textAlign: "center", border: "1px solid #e2e8f0", color: "#94a3b8" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>📚</div>
            <div style={{ fontWeight: 600, fontSize: "16px", color: "#374151" }}>
              {templates.length === 0 ? "Noch keine Vorlagen vorhanden" : "Keine Vorlagen gefunden"}
            </div>
            <div style={{ fontSize: "13px", marginTop: "6px" }}>
              {templates.length === 0
                ? "Erstelle deinen ersten Test – er wird automatisch als Vorlage gespeichert."
                : "Versuche einen anderen Suchbegriff oder Filter."}
            </div>
            {templates.length === 0 && (
              <button onClick={() => navigate("testEditor", null)} style={{
                marginTop: "20px", padding: "10px 24px", background: "#2563a8", color: "#fff",
                border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer"
              }}>✏️ Erste Vorlage erstellen</button>
            )}
          </div>
        )}

        {/* Template Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
          {filtered.map(template => {
            const sc = getSubjectColor(template.subject);
            const assignCount = getAssignCount(template.id);
            const mins = Math.round((template.timeLimit || 0) / 60);
            return (
              <div key={template.id} style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {/* Card Header */}
                <div style={{ padding: "20px 20px 14px", flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                    {template.subject && (
                      <span style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 }}>
                        {template.subject}
                      </span>
                    )}
                    {assignCount > 0 && (
                      <span style={{ background: "#f0f7ff", color: "#2563a8", borderRadius: "6px", padding: "3px 8px", fontSize: "11px", fontWeight: 600 }}>
                        {assignCount}× zugewiesen
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a", marginBottom: "8px", lineHeight: 1.3 }}>
                    {template.title}
                  </div>
                  {template.description && (
                    <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>{template.description}</div>
                  )}
                  <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#94a3b8" }}>
                    <span>📋 {template.questions || 0} Aufgaben</span>
                    {mins > 0 && <span>⏱ {mins} Min.</span>}
                    {template.antiCheat && <span>🛡️ Anti-Cheat</span>}
                  </div>
                </div>

                {/* Card Actions */}
                <div style={{ padding: "12px 20px", borderTop: "1px solid #f1f5f9", display: "flex", gap: "8px" }}>
                  <button onClick={() => {
                      setAssignModal(template);
                      setAssignGroupId("");
                      setAssignTimeLimit(Math.round((template.timeLimit || 1200) / 60));
                      setAssignTimingMode(template.timingMode || "countdown");
                      setAssignAntiCheat(template.antiCheat || false);
                    }}
                    style={{ flex: 1, padding: "8px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                    👥 Zuweisen
                  </button>
                  <button onClick={() => navigate("testEditor", { ...template, isTemplate: true })}
                    style={{ padding: "8px 12px", background: "#f8fafc", color: "#374151", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
                    ✏️
                  </button>
                  <button onClick={() => setDeleteConfirm(template.id)}
                    style={{ padding: "8px 12px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Assign Modal */}
      {assignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "440px", width: "100%" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px", textAlign: "center" }}>👥</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px", color: "#0f172a", textAlign: "center" }}>
              Test zuweisen
            </h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px", textAlign: "center" }}>
              „{assignModal.title}"
            </p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Lerngruppe wählen *</label>
              {groups.length === 0 ? (
                <div style={{ background: "#fef9c3", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#92400e" }}>
                  ⚠️ Noch keine Lerngruppen vorhanden.{" "}
                  <button onClick={() => { setAssignModal(null); navigate("groups"); }} style={{ background: "none", border: "none", color: "#2563a8", cursor: "pointer", fontWeight: 600, fontSize: "13px" }}>
                    Jetzt anlegen →
                  </button>
                </div>
              ) : (
                <select value={assignGroupId} onChange={e => setAssignGroupId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                  <option value="">– Gruppe auswählen –</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} {g.subject ? `(${g.subject})` : ""} · {g.count} Schüler/innen</option>)}
                </select>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Bearbeitungszeit (Min.)</label>
                <input type="number" min={1} max={180} value={assignTimeLimit} onChange={e => setAssignTimeLimit(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                  Timer-Modus
                  {!assignGroupId && <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: "6px" }}>(erst Gruppe wählen)</span>}
                </label>
                <select value={assignTimingMode}
                  onChange={e => setAssignTimingMode(e.target.value)}
                  disabled={!assignGroupId}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: assignGroupId ? "#fff" : "#f8fafc", boxSizing: "border-box", color: assignGroupId ? "#0f172a" : "#94a3b8", cursor: assignGroupId ? "pointer" : "not-allowed" }}>
                  <option value="countdown">Countdown ab Start</option>
                  <option value="window">Festes Zeitfenster</option>
                </select>
              </div>
            </div>

            {assignGroupId && assignTimingMode === "window" && (
              <div style={{ background: "#f0f7ff", borderRadius: "12px", padding: "16px", marginBottom: "16px", border: "1px solid #bfdbfe" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e3a5f", marginBottom: "12px" }}>📅 Prüfungszeitfenster</div>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Prüfungstag</label>
                  <input type="date" value={assignDate} onChange={e => setAssignDate(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", border: "2px solid #bfdbfe", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit", background: "#fff" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Uhrzeit Start</label>
                    <input type="time" value={assignTimeStart} onChange={e => setAssignTimeStart(e.target.value)}
                      style={{ width: "100%", padding: "9px 12px", border: "2px solid #bfdbfe", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit", background: "#fff" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Uhrzeit Ende</label>
                    <input type="time" value={assignTimeEnd} onChange={e => setAssignTimeEnd(e.target.value)}
                      style={{ width: "100%", padding: "9px 12px", border: "2px solid #bfdbfe", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit", background: "#fff" }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Zeitzone</label>
                  <select value={assignTimezone} onChange={e => setAssignTimezone(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", border: "2px solid #bfdbfe", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                    <option value="Europe/Berlin">Europa/Berlin (MEZ/MESZ)</option>
                    <option value="Europe/Vienna">Europa/Wien (MEZ/MESZ)</option>
                    <option value="Europe/Zurich">Europa/Zürich (MEZ/MESZ)</option>
                    <option value="Europe/London">Europa/London (GMT/BST)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
                {assignDate && assignTimeStart && assignTimeEnd && (
                  <div style={{ marginTop: "10px", fontSize: "12px", color: "#2563a8", fontWeight: 600 }}>
                    ✓ Test verfügbar am {new Date(assignDate).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} von {assignTimeStart} bis {assignTimeEnd} Uhr
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: "24px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" checked={assignAntiCheat} onChange={e => setAssignAntiCheat(e.target.checked)}
                  style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
                🛡️ Anti-Cheat aktivieren
              </label>
              {assignAntiCheat && (
                <div style={{ marginTop: "8px", background: "#f0f7ff", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", color: "#2563a8", border: "1px solid #bfdbfe" }}>
                  Aufgaben werden in zufälliger Reihenfolge und mit unterschiedlichen Farben angezeigt.
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setAssignModal(null)}
                style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>
                Abbrechen
              </button>
              <button onClick={handleAssign} disabled={!assignGroupId || !windowValid}
                style={{ flex: 1, padding: "11px", background: (assignGroupId && windowValid) ? "#2563a8" : "#e2e8f0", color: (assignGroupId && windowValid) ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", fontWeight: 700, cursor: (assignGroupId && windowValid) ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
                Test aktivieren →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "360px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Vorlage löschen?</h3>
            <p style={{ color: "#64748b", marginBottom: "8px", fontSize: "14px" }}>
              „{templates.find(t => t.id === deleteConfirm)?.title}" wird als Vorlage gelöscht.
            </p>
            <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "12px" }}>
              Bereits zugewiesene Tests bleiben erhalten.
            </p>
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
