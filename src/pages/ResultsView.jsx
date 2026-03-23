import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import TeacherLayout from "../components/TeacherLayout";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

export default function ResultsView({ navigate, onLogout, currentUser, assignment }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (assignment?.id) fetchSubmissions(); }, [assignment]);

  const fetchSubmissions = async () => {
    setLoading(true);
    const { data } = await supabase.from("submissions").select("*").eq("assignment_id", assignment.id).order("submitted_at", { ascending: false });
    setSubmissions(data || []);
    setLoading(false);
  };

  const saveOverrides = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    const updatedOverrides = { ...selectedSubmission.manual_overrides, ...overrides };
    const totalPoints = selectedSubmission.total_points || 1;
    const newScore = Object.values({ ...selectedSubmission.ai_corrections, ...updatedOverrides }).reduce((sum, v) => sum + Number(v || 0), 0);
    await supabase.from("submissions").update({ manual_overrides: updatedOverrides, score: newScore, reviewed: true }).eq("id", selectedSubmission.id);
    setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? { ...s, manual_overrides: updatedOverrides, score: newScore, reviewed: true } : s));
    setSaving(false);
  };

  const avg = submissions.length > 0
    ? (submissions.reduce((s, r) => s + ((r.score || 0) / (r.total_points || 1)) * 100, 0) / submissions.length).toFixed(1)
    : null;

  if (!assignment) return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", color: "#94a3b8", textAlign: "center" }}>Kein Test ausgewählt.</div>
    </TeacherLayout>
  );

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ marginBottom: "28px" }}>
          <button onClick={() => navigate("dashboard")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", marginBottom: "8px", padding: 0 }}>← Zurück zum Dashboard</button>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{assignment.title}</h1>
          <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
            {submissions.length} Abgaben{avg ? ` · Ø ${avg}%` : ""}
          </p>
        </div>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : submissions.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center", border: "1px solid #e2e8f0", color: "#94a3b8" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📭</div>
            <div style={{ fontWeight: 600 }}>Noch keine Abgaben</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: selectedSubmission ? "1fr 1fr" : "1fr", gap: "20px" }}>
            <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Schüler/in", "Punkte", "Note", "Status", ""].map(h => (
                      <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s, i) => (
                    <tr key={s.id} style={{ borderBottom: i < submissions.length - 1 ? "1px solid #f8fafc" : "none", background: selectedSubmission?.id === s.id ? "#f0f7ff" : "transparent" }}>
                      <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{s.username}</td>
                      <td style={{ padding: "13px 16px", fontSize: "14px" }}>
                        <span style={{ fontWeight: 700 }}>{s.score ?? "–"}</span>
                        {s.total_points && <span style={{ color: "#94a3b8", fontSize: "12px" }}>/{s.total_points}</span>}
                      </td>
                      <td style={{ padding: "13px 16px" }}>
                        {s.grade ? <span style={{ fontWeight: 800, fontSize: "18px", color: GRADE_COLOR[s.grade] || "#374151" }}>{s.grade}</span> : <span style={{ color: "#94a3b8" }}>–</span>}
                      </td>
                      <td style={{ padding: "13px 16px" }}>
                        {s.reviewed
                          ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Geprüft</span>
                          : <span style={{ background: "#fef9c3", color: "#ca8a04", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>Offen</span>}
                      </td>
                      <td style={{ padding: "13px 16px" }}>
                        <button onClick={() => { setSelectedSubmission(s); setOverrides({}); }} style={{ padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer" }}>Details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedSubmission && (
              <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", padding: "22px", overflowY: "auto", maxHeight: "600px" }}>
                <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 700 }}>{selectedSubmission.username}</h3>
                <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: "13px" }}>
                  Abgegeben: {new Date(selectedSubmission.submitted_at).toLocaleString("de-DE")}
                </p>
                {Object.entries(selectedSubmission.answers || {}).map(([qId, answer], i) => {
                  const aiCorrection = selectedSubmission.ai_corrections?.[qId];
                  const override = overrides[qId];
                  const currentPoints = override !== undefined ? override : (selectedSubmission.manual_overrides?.[qId] ?? aiCorrection?.points ?? null);
                  return (
                    <div key={qId} style={{ marginBottom: "16px", background: "#f8fafc", borderRadius: "12px", padding: "14px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Aufgabe {i + 1}</div>
                      <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px" }}><em>Antwort:</em> {String(answer)}</div>
                      {aiCorrection?.comment && (
                        <div style={{ background: "#f5f3ff", borderRadius: "8px", padding: "10px", marginBottom: "8px", fontSize: "12px", color: "#7c3aed", border: "1px solid #ddd6fe" }}>
                          🤖 {aiCorrection.comment}
                        </div>
                      )}
                      {currentPoints !== null && (
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <label style={{ fontSize: "12px", color: "#64748b" }}>Punkte:</label>
                          <input type="number" min={0} step={0.5} value={currentPoints}
                            onChange={e => setOverrides(prev => ({ ...prev, [qId]: Number(e.target.value) }))}
                            style={{ width: "56px", padding: "4px 8px", border: "2px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textAlign: "center" }} />
                          {overrides[qId] !== undefined && <span style={{ fontSize: "11px", background: "#fef9c3", color: "#ca8a04", borderRadius: "5px", padding: "2px 6px" }}>✏️ Geändert</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {Object.keys(selectedSubmission.answers || {}).length === 0 && (
                  <p style={{ color: "#94a3b8", fontSize: "13px" }}>Keine Detailantworten verfügbar.</p>
                )}
                <button onClick={saveOverrides} disabled={saving} style={{ width: "100%", marginTop: "8px", padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: saving ? "not-allowed" : "pointer" }}>
                  {saving ? "Wird gespeichert..." : "✓ Korrekturen speichern"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}
