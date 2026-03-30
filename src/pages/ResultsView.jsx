import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

export default function ResultsView({ navigate, onLogout, currentUser, assignment }) {
  const [submissions, setSubmissions] = useState([]);
  const [groupUsernames, setGroupUsernames] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [makeupModal, setMakeupModal] = useState(false);
  const [makeupSelected, setMakeupSelected] = useState(new Set());
  const [makeupTemplateId, setMakeupTemplateId] = useState("");
  const [makeupTimeLimit, setMakeupTimeLimit] = useState(20);
  const [makeupTimingMode, setMakeupTimingMode] = useState("countdown");
  const [makeupAntiCheat, setMakeupAntiCheat] = useState(false);
  const [creatingMakeup, setCreatingMakeup] = useState(false);

  useEffect(() => {
    if (!assignment?.id) return;
    fetchAll();
    const channel = supabase
      .channel(`submissions-${assignment.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `assignment_id=eq.${assignment.id}` }, () => fetchSubmissions())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [assignment]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchSubmissions(), fetchGroup(), fetchTemplates()]);
    setLoading(false);
  };

  const fetchSubmissions = async () => {
    // Load submissions from this assignment AND any makeup assignments linked to it
    const { data: makeupAssignments } = await supabase
      .from("assignments").select("id").eq("parent_assignment_id", assignment.id);
    const makeupIds = (makeupAssignments || []).map(a => a.id);
    const allIds = [assignment.id, ...makeupIds];

    const { data } = await supabase.from("submissions").select("*, assignments(title)")
      .in("assignment_id", allIds).order("submitted_at", { ascending: false });
    setSubmissions(data || []);
    setLoading(false);
  };

  const fetchGroup = async () => {
    const { data } = await supabase.from("groups").select("usernames").eq("id", assignment.group_id).single();
    setGroupUsernames(data?.usernames || []);
  };

  const fetchTemplates = async () => {
    const { data } = await supabase.from("templates").select("id, title").order("created_at", { ascending: false });
    setTemplates(data || []);
  };

  const createMakeupTest = async () => {
    if (!makeupTemplateId || makeupSelected.size === 0) return;
    setCreatingMakeup(true);
    const { data: t } = await supabase.from("templates").select("*").eq("id", makeupTemplateId).single();

    await supabase.from("assignments").insert({
      template_id: Number(makeupTemplateId),
      group_id: assignment.group_id,
      teacher_id: currentUser?.id,
      title: `${t.title} (Nachtest)`,
      status: "aktiv",
      time_limit: makeupTimeLimit * 60,
      timing_mode: makeupTimingMode,
      anti_cheat: makeupAntiCheat,
      question_data: t.question_data,
      grading_scale: t.grading_scale || assignment.grading_scale,
      parent_assignment_id: assignment.id,
      makeup_usernames: [...makeupSelected],
    });

    setCreatingMakeup(false);
    setMakeupModal(false);
    setMakeupSelected(new Set());
    setMakeupTemplateId("");
    await fetchSubmissions();
  };

  const saveOverrides = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    const updatedOverrides = { ...selectedSubmission.manual_overrides, ...overrides };
    const corrections = selectedSubmission.ai_corrections || {};
    let newScore = 0;
    for (const [qId, correction] of Object.entries(corrections)) {
      if (updatedOverrides[qId] !== undefined) newScore += Number(updatedOverrides[qId]);
      else if (correction.points !== null && correction.points !== undefined) newScore += Number(correction.points);
    }
    const totalPoints = selectedSubmission.total_points || 1;
    const percent = (newScore / totalPoints) * 100;
    const { data: assignmentData } = await supabase.from("assignments").select("grading_scale").eq("id", selectedSubmission.assignment_id).single();
    const gradingScale = assignmentData?.grading_scale || [];
    const sorted = [...gradingScale].sort((a, b) => b.minPercent - a.minPercent);
    let newGrade = "6";
    for (const g of sorted) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }

    await supabase.from("submissions").update({ manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true }).eq("id", selectedSubmission.id);
    setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? { ...s, manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true } : s));
    setSelectedSubmission(prev => ({ ...prev, manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true }));
    setOverrides({});
    setSaving(false);
  };

  const submittedUsernames = new Set(submissions.map(s => s.username));
  // For makeup tests only show the selected students, otherwise show full group
  const relevantUsernames = assignment.makeup_usernames?.length
    ? assignment.makeup_usernames
    : groupUsernames;
  const missingStudents = relevantUsernames.filter(u => !submittedUsernames.has(u));
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
            <button onClick={fetchSubmissions} style={{ marginLeft: "12px", background: "none", border: "none", color: "#2563a8", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>🔄 Aktualisieren</button>
          </p>
        </div>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : (
          <>
            {/* Missing students */}
            {missingStudents.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "14px", padding: "18px 20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>
                    ⚠️ {missingStudents.length} Schüler/in{missingStudents.length !== 1 ? "nen haben" : " hat"} nicht teilgenommen
                  </div>
                  <button onClick={() => { setMakeupModal(true); setMakeupSelected(new Set(missingStudents)); setMakeupTemplateId(""); setMakeupTimeLimit(Math.round((assignment.time_limit || 1200) / 60)); setMakeupTimingMode("countdown"); setMakeupAntiCheat(assignment.anti_cheat || false); }}
                    style={{ padding: "7px 14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                    + Nachtest erstellen
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {missingStudents.map(u => (
                    <span key={u} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: "6px", padding: "4px 10px", fontSize: "13px", fontWeight: 600, color: "#374151" }}>{u}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Submissions table */}
            {submissions.length === 0 ? (
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
                          <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>
                            {s.username}
                            {s.assignments?.title !== assignment.title && (
                              <span style={{ marginLeft: "6px", fontSize: "10px", background: "#f0f7ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px" }}>Nachtest</span>
                            )}
                          </td>
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
                    {Object.entries(selectedSubmission.ai_corrections || {}).map(([qId, correction], i) => {
                      const override = overrides[qId];
                      const currentPoints = override !== undefined ? Number(override) : (selectedSubmission.manual_overrides?.[qId] !== undefined ? selectedSubmission.manual_overrides[qId] : correction.points);
                      const isOpen = correction.needsReview;
                      return (
                        <div key={qId} style={{ marginBottom: "16px", background: "#f8fafc", borderRadius: "12px", padding: "14px", border: `1px solid ${correction.correct === true ? "#bbf7d0" : correction.correct === false ? "#fecaca" : "#e2e8f0"}` }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                            Aufgabe {i + 1}
                            {correction.correct === true && <span style={{ marginLeft: "8px", color: "#16a34a" }}>✓</span>}
                            {correction.correct === false && <span style={{ marginLeft: "8px", color: "#dc2626" }}>✗</span>}
                            {correction.correct === null && <span style={{ marginLeft: "8px", color: "#ca8a04" }}>⏳</span>}
                          </div>
                          <div style={{ fontSize: "13px", color: "#374151", marginBottom: "6px" }}>
                            <em style={{ color: "#94a3b8" }}>Antwort:</em> {correction.studentAnswer ?? "–"}
                          </div>
                          {correction.comment && (
                            <div style={{ background: isOpen ? "#fef9c3" : correction.correct ? "#dcfce7" : "#fef2f2", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: isOpen ? "#92400e" : correction.correct ? "#16a34a" : "#dc2626" }}>
                              {correction.comment}
                            </div>
                          )}
                          {correction.solution && (
                            <div style={{ background: "#f0f7ff", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: "#1e3a5f", border: "1px solid #bfdbfe" }}>
                              <strong>📝 Musterlösung:</strong> {correction.solution}
                            </div>
                          )}
                          {correction.partialPoints?.length > 0 && (
                            <div style={{ marginBottom: "8px" }}>
                              <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>Teilbepunktung:</div>
                              {correction.partialPoints.map((p, pi) => (
                                <div key={pi} style={{ fontSize: "12px", color: "#374151", display: "flex", gap: "6px", marginBottom: "2px" }}>
                                  <span style={{ background: "#f1f5f9", borderRadius: "4px", padding: "1px 6px", fontWeight: 700, color: "#2563a8" }}>{p.points} Pkt.</span>
                                  <span>{p.description}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <label style={{ fontSize: "12px", color: "#64748b" }}>Punkte:</label>
                            <input type="number" min={0} max={correction.maxPoints} step={0.5}
                              value={currentPoints ?? ""} placeholder={currentPoints === null ? "–" : ""}
                              onChange={e => setOverrides(prev => ({ ...prev, [qId]: Number(e.target.value) }))}
                              style={{ width: "64px", padding: "4px 8px", border: "2px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textAlign: "center" }} />
                            <span style={{ fontSize: "12px", color: "#94a3b8" }}>/ {correction.maxPoints}</span>
                            {overrides[qId] !== undefined && <span style={{ fontSize: "11px", background: "#fef9c3", color: "#ca8a04", borderRadius: "5px", padding: "2px 6px" }}>✏️ Geändert</span>}
                          </div>
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
          </>
        )}
      </div>

      {/* MAKEUP TEST MODAL */}
      {makeupModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "500px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px", color: "#0f172a" }}>Nachtest erstellen</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>
              Ergebnisse werden dem Original-Test „{assignment.title}" zugeordnet.
            </p>

            {/* Student selection */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "8px" }}>
                Teilnehmende Schüler/innen
                <span style={{ marginLeft: "8px", fontWeight: 400, color: "#94a3b8" }}>({makeupSelected.size} ausgewählt)</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {missingStudents.map(u => {
                  const selected = makeupSelected.has(u);
                  return (
                    <button key={u} onClick={() => setMakeupSelected(prev => {
                      const next = new Set(prev);
                      next.has(u) ? next.delete(u) : next.add(u);
                      return next;
                    })} style={{ padding: "8px 12px", borderRadius: "8px", cursor: "pointer", textAlign: "left", border: `2px solid ${selected ? "#2563a8" : "#e2e8f0"}`, background: selected ? "#eff6ff" : "#f8fafc", fontFamily: "inherit" }}>
                      <span style={{ fontSize: "12px", color: selected ? "#2563a8" : "#94a3b8", display: "block" }}>{selected ? "✓ Ausgewählt" : "Nicht ausgewählt"}</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? "#1e40af" : "#374151" }}>{u}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button onClick={() => setMakeupSelected(new Set(missingStudents))} style={{ fontSize: "12px", color: "#2563a8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Alle auswählen</button>
                <span style={{ color: "#e2e8f0" }}>|</span>
                <button onClick={() => setMakeupSelected(new Set())} style={{ fontSize: "12px", color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Keine</button>
              </div>
            </div>

            {/* Test settings */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Test-Vorlage wählen *</label>
              <select value={makeupTemplateId} onChange={e => setMakeupTemplateId(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                <option value="">– Vorlage auswählen –</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Bearbeitungszeit (Min.)</label>
                <input type="number" min={1} max={180} value={makeupTimeLimit} onChange={e => setMakeupTimeLimit(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Timer-Modus</label>
                <select value={makeupTimingMode} onChange={e => setMakeupTimingMode(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                  <option value="countdown">Countdown ab Start</option>
                  <option value="lobby">Lobby</option>
                </select>
              </div>
            </div>

            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "24px" }}>
              <input type="checkbox" checked={makeupAntiCheat} onChange={e => setMakeupAntiCheat(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
              🛡️ Anti-Cheat aktivieren
            </label>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMakeupModal(false)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={createMakeupTest} disabled={!makeupTemplateId || makeupSelected.size === 0 || creatingMakeup}
                style={{ flex: 1, padding: "11px", background: (makeupTemplateId && makeupSelected.size > 0) ? "#2563a8" : "#e2e8f0", color: (makeupTemplateId && makeupSelected.size > 0) ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", fontWeight: 700, cursor: (makeupTemplateId && makeupSelected.size > 0) ? "pointer" : "not-allowed" }}>
                {creatingMakeup ? "Wird erstellt..." : `Nachtest für ${makeupSelected.size} Schüler/in aktivieren →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
