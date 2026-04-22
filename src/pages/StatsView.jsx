import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

export default function StatsView({ navigate, onLogout, currentUser }) {
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterGroup, setFilterGroup] = useState("all");
  const [view, setView] = useState("tests"); // "tests" | "students"

  useEffect(() => {
    const load = async () => {
      const [{ data: asgn }, { data: subs }, { data: grps }] = await Promise.all([
        supabase.from("assignments").select("id, title, status, group_id, created_at, grading_scale, groups(name, subject)").eq("teacher_id", currentUser.id).order("created_at", { ascending: false }),
        supabase.from("submissions").select("id, username, score, total_points, grade, assignment_id, submitted_at"),
        supabase.from("groups").select("id, name, subject").eq("teacher_id", currentUser.id),
      ]);
      setAssignments(asgn || []);
      setSubmissions(subs || []);
      setGroups(grps || []);
      setLoading(false);
    };
    load();
  }, []);

  const filteredAssignments = filterGroup === "all"
    ? assignments
    : assignments.filter(a => String(a.group_id) === filterGroup);

  // Tests-Ansicht: ein Test pro Zeile mit Ø Note und Teilnahme
  const testRows = filteredAssignments.map(a => {
    const subs = submissions.filter(s => s.assignment_id === a.id);
    const graded = subs.filter(s => s.grade);
    const avgPercent = subs.length > 0
      ? Math.round(subs.reduce((sum, s) => sum + (s.total_points > 0 ? (s.score / s.total_points) * 100 : 0), 0) / subs.length)
      : null;
    const grades = graded.map(s => Number(s.grade)).filter(g => !isNaN(g));
    const avgGrade = grades.length > 0 ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : null;
    const gradeColor = avgGrade ? GRADE_COLOR[String(Math.round(Number(avgGrade)))] || "#374151" : "#94a3b8";
    return { ...a, subs, avgPercent, avgGrade, gradeColor };
  });

  // Schüler-Ansicht: ein Schüler pro Zeile mit allen Noten
  const allUsernames = [...new Set(submissions.filter(s =>
    filterGroup === "all" || filteredAssignments.some(a => a.id === s.assignment_id)
  ).map(s => s.username))].sort();

  const studentRows = allUsernames.map(username => {
    const stuSubs = submissions.filter(s =>
      s.username === username &&
      (filterGroup === "all" || filteredAssignments.some(a => a.id === s.assignment_id))
    );
    const grades = stuSubs.map(s => Number(s.grade)).filter(g => !isNaN(g) && g > 0);
    const avgGrade = grades.length > 0 ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : null;
    const avgPercent = stuSubs.length > 0
      ? Math.round(stuSubs.reduce((sum, s) => sum + (s.total_points > 0 ? (s.score / s.total_points) * 100 : 0), 0) / stuSubs.length)
      : null;
    return { username, stuSubs, avgGrade, avgPercent };
  });

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="stats">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Statistik</h1>
          <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>Übersicht aller Tests und Schülernoten</p>
        </div>

        {/* Filter & View Toggle */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", alignItems: "center" }}>
          <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", background: "#fff", fontFamily: "inherit" }}>
            <option value="all">Alle Gruppen</option>
            {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}{g.subject ? ` (${g.subject})` : ""}</option>)}
          </select>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "8px", padding: "3px" }}>
            {[{ id: "tests", label: "Nach Tests" }, { id: "students", label: "Nach Schülern" }].map(v => (
              <button key={v.id} onClick={() => setView(v.id)}
                style={{ padding: "6px 14px", background: view === v.id ? "#fff" : "transparent", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: view === v.id ? 700 : 400, color: view === v.id ? "#0f172a" : "#64748b", cursor: "pointer", boxShadow: view === v.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : view === "tests" ? (
          <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Test", "Gruppe", "Teilnehmer", "Ø Note", "Ø Prozent", "Status", ""].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {testRows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Keine Tests gefunden</td></tr>
                ) : testRows.map((a, i) => (
                  <tr key={a.id} style={{ borderBottom: i < testRows.length - 1 ? "1px solid #f8fafc" : "none" }}>
                    <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{a.title}</td>
                    <td style={{ padding: "13px 16px", fontSize: "13px", color: "#64748b" }}>{a.groups?.name || "–"}</td>
                    <td style={{ padding: "13px 16px", fontSize: "14px", fontWeight: 600 }}>{a.subs.length}</td>
                    <td style={{ padding: "13px 16px" }}>
                      {a.avgGrade
                        ? <span style={{ fontSize: "20px", fontWeight: 900, color: a.gradeColor }}>{a.avgGrade}</span>
                        : <span style={{ color: "#94a3b8" }}>–</span>}
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      {a.avgPercent !== null ? (
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600 }}>{a.avgPercent}%</div>
                          <div style={{ height: "4px", background: "#f1f5f9", borderRadius: "4px", width: "80px", marginTop: "3px" }}>
                            <div style={{ height: "4px", borderRadius: "4px", background: a.gradeColor, width: `${a.avgPercent}%` }} />
                          </div>
                        </div>
                      ) : <span style={{ color: "#94a3b8" }}>–</span>}
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      <span style={{ fontSize: "12px", background: a.status === "beendet" ? "#f1f5f9" : "#dcfce7", color: a.status === "beendet" ? "#64748b" : "#16a34a", borderRadius: "6px", padding: "2px 8px", fontWeight: 600 }}>
                        {a.status === "beendet" ? "Beendet" : "Aktiv"}
                      </span>
                    </td>
                    <td style={{ padding: "13px 16px" }}>
                      <button onClick={() => navigate("results", a)} style={{ padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#374151" }}>
                        Details →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Schüler/in", "Tests absolviert", "Ø Note", "Ø Prozent", "Letzte Abgabe"].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {studentRows.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Keine Schüler gefunden</td></tr>
                ) : studentRows.map((s, i) => {
                  const gradeNum = s.avgGrade ? Math.round(Number(s.avgGrade)) : null;
                  const gradeColor = gradeNum ? GRADE_COLOR[String(gradeNum)] || "#374151" : "#94a3b8";
                  const lastSub = s.stuSubs.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
                  return (
                    <tr key={s.username} style={{ borderBottom: i < studentRows.length - 1 ? "1px solid #f8fafc" : "none" }}>
                      <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{s.username}</td>
                      <td style={{ padding: "13px 16px", fontSize: "14px", fontWeight: 600 }}>{s.stuSubs.length}</td>
                      <td style={{ padding: "13px 16px" }}>
                        {s.avgGrade
                          ? <span style={{ fontSize: "20px", fontWeight: 900, color: gradeColor }}>{s.avgGrade}</span>
                          : <span style={{ color: "#94a3b8" }}>–</span>}
                      </td>
                      <td style={{ padding: "13px 16px" }}>
                        {s.avgPercent !== null ? (
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>{s.avgPercent}%</div>
                            <div style={{ height: "4px", background: "#f1f5f9", borderRadius: "4px", width: "80px", marginTop: "3px" }}>
                              <div style={{ height: "4px", borderRadius: "4px", background: gradeColor, width: `${s.avgPercent}%` }} />
                            </div>
                          </div>
                        ) : <span style={{ color: "#94a3b8" }}>–</span>}
                      </td>
                      <td style={{ padding: "13px 16px", fontSize: "13px", color: "#64748b" }}>
                        {lastSub ? new Date(lastSub.submitted_at).toLocaleDateString("de-DE") : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}
