import { useState } from "react";
import TeacherLayout from "../components/TeacherLayout";

const DEMO_RESULTS = [
  {
    username: "blauer-Adler", score: 18, total: 24, grade: "2", aiCorrected: true, reviewed: false,
    answers: [
      { q: "Was ist 3/4 + 1/4?", type: "mc", studentAnswer: "1", correct: true, points: 2, maxPoints: 2 },
      { q: "Erkläre den Begriff 'Nenner'.", type: "open", studentAnswer: "Der Nenner ist die untere Zahl beim Bruch.", correct: null, points: 3, maxPoints: 4, aiComment: "Richtige Kernaussage, aber unvollständig. Kein Hinweis auf die Bedeutung als Teiler." },
    ]
  },
  { username: "roter-Tiger", score: 22, total: 24, grade: "1", aiCorrected: false, reviewed: true, answers: [] },
  { username: "grüner-Fuchs", score: 11, total: 24, grade: "4", aiCorrected: true, reviewed: false, answers: [] },
  { username: "schneller-Wolf", score: 14, total: 24, grade: "3", aiCorrected: true, reviewed: false, answers: [] },
];

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

export default function ResultsView({ navigate, onLogout, currentUser, test, groups }) {
  const [selectedResult, setSelectedResult] = useState(null);
  const [overrides, setOverrides] = useState({});

  const avg = (DEMO_RESULTS.reduce((s, r) => s + (r.score / r.total) * 100, 0) / DEMO_RESULTS.length).toFixed(1);

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Ergebnisse</h1>
          <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
            Mathe – Bruchrechnung Kl. 6 · Ø {avg}% · {DEMO_RESULTS.length} Abgaben
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: selectedResult ? "1fr 1fr" : "1fr", gap: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Schüler/in", "Punkte", "Note", "KI-Korrektur", "Status", ""].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DEMO_RESULTS.map((r, i) => (
                  <tr key={r.username} style={{
                    borderBottom: i < DEMO_RESULTS.length - 1 ? "1px solid #f8fafc" : "none",
                    background: selectedResult?.username === r.username ? "#f0f7ff" : "transparent"
                  }}>
                    <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{r.username}</td>
                    <td style={{ padding: "13px 16px", fontSize: "14px" }}>
                      <span style={{ fontWeight: 700 }}>{r.score}</span>
                      <span style={{ color: "#94a3b8", fontSize: "12px" }}>/{r.total}</span>
                      <div style={{ marginTop: "3px", background: "#e2e8f0", borderRadius: "4px", height: "4px", width: "60px" }}>
                        <div style={{ background: "#2563a8", borderRadius: "4px", height: "4px", width: `${(r.score / r.total) * 60}px` }} />
                      </div>
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      <span style={{ fontWeight: 800, fontSize: "18px", color: GRADE_COLOR[r.grade] || "#374151" }}>{r.grade}</span>
                    </td>
                    <td style={{ padding: "13px 16px", fontSize: "13px" }}>
                      {r.aiCorrected ? <span style={{ color: "#7c3aed" }}>🤖 KI-Vorschlag</span> : <span style={{ color: "#94a3b8" }}>–</span>}
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      {r.reviewed
                        ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Geprüft</span>
                        : <span style={{ background: "#fef9c3", color: "#ca8a04", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>Offen</span>}
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      <button onClick={() => setSelectedResult(selectedResult?.username === r.username ? null : r)} style={{
                        padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px",
                        background: "#fff", fontSize: "12px", cursor: "pointer"
                      }}>Details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedResult && (
            <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", padding: "22px", overflowY: "auto", maxHeight: "600px" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 700 }}>{selectedResult.username}</h3>
              <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: "13px" }}>
                {selectedResult.score}/{selectedResult.total} Punkte · Note {selectedResult.grade}
              </p>
              {selectedResult.answers.map((a, i) => (
                <div key={i} style={{
                  marginBottom: "16px", background: "#f8fafc", borderRadius: "12px", padding: "14px",
                  border: `1px solid ${a.correct === true ? "#bbf7d0" : a.correct === false ? "#fecaca" : "#e2e8f0"}`
                }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                    Aufgabe {i + 1}: {a.q}
                  </div>
                  <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>
                    <em>Antwort:</em> {a.studentAnswer}
                  </div>
                  {a.type === "open" && a.aiComment && (
                    <div style={{ background: "#f5f3ff", borderRadius: "8px", padding: "10px", marginBottom: "8px", fontSize: "12px", color: "#7c3aed", border: "1px solid #ddd6fe" }}>
                      🤖 KI-Einschätzung: {a.aiComment}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <label style={{ fontSize: "12px", color: "#64748b" }}>Punkte vergeben:</label>
                    <input type="number" min={0} max={a.maxPoints} step={0.5}
                      defaultValue={overrides[`${selectedResult.username}-${i}`] ?? a.points}
                      onChange={e => setOverrides(prev => ({ ...prev, [`${selectedResult.username}-${i}`]: e.target.value }))}
                      style={{ width: "56px", padding: "4px 8px", border: "2px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textAlign: "center" }} />
                    <span style={{ fontSize: "12px", color: "#94a3b8" }}>/ {a.maxPoints}</span>
                    {overrides[`${selectedResult.username}-${i}`] !== undefined && (
                      <span style={{ fontSize: "11px", background: "#fef9c3", color: "#ca8a04", borderRadius: "5px", padding: "2px 6px" }}>✏️ Geändert</span>
                    )}
                  </div>
                </div>
              ))}
              {selectedResult.answers.length === 0 && (
                <p style={{ color: "#94a3b8", fontSize: "13px" }}>Keine Detailantworten verfügbar.</p>
              )}
              <button style={{
                width: "100%", marginTop: "8px", padding: "10px", background: "#16a34a",
                color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
              }}>✓ Korrekturen speichern</button>
            </div>
          )}
        </div>
      </div>
    </TeacherLayout>
  );
}
