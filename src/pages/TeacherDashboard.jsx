import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import TeacherLayout from "../components/TeacherLayout";

const STATUS_STYLE = {
  aktiv:   { bg: "#dcfce7", color: "#16a34a", label: "Aktiv" },
  beendet: { bg: "#f1f5f9", color: "#64748b", label: "Beendet" },
  entwurf: { bg: "#fef9c3", color: "#ca8a04", label: "Entwurf" },
};

export default function TeacherDashboard({ navigate, onLogout, currentUser }) {
  const [assignments, setAssignments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: asgn }, { data: grps }] = await Promise.all([
      supabase.from("assignments").select("*, groups(name, subject)").order("created_at", { ascending: false }),
      supabase.from("groups").select("*"),
    ]);
    setAssignments(asgn || []);
    setGroups(grps || []);
    setLoading(false);
  };

  const toggleStatus = async (id, currentStatus) => {
    const next = currentStatus === "aktiv" ? "beendet" : "aktiv";
    await supabase.from("assignments").update({ status: next }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: next } : a));
  };

  const deleteAssignment = async (id) => {
    await supabase.from("assignments").delete().eq("id", id);
    setAssignments(prev => prev.filter(a => a.id !== id));
    setDeleteConfirm(null);
  };

  const getSubmissionCount = (assignment) => {
    // Will be enhanced with real submission counts in Iteration 3
    return { submissions: 0, total: assignment.groups?.count || 0 };
  };

  const stats = [
    { label: "Tests gesamt", value: assignments.length, icon: "📋", color: "#2563a8" },
    { label: "Aktive Tests", value: assignments.filter(a => a.status === "aktiv").length, icon: "🟢", color: "#16a34a" },
    { label: "Lerngruppen", value: groups.length, icon: "👥", color: "#7c3aed" },
    { label: "Tests diesen Monat", value: `${assignments.length} / 30`, icon: "📅", color: "#ea580c" },
  ];

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="dashboard">
      <div style={{ padding: "32px" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Willkommen, {currentUser?.name?.split(" ")[0]} 👋
          </h1>
          <p style={{ color: "#64748b", marginTop: "4px", fontSize: "14px" }}>Hier ist deine Übersicht.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: "#fff", borderRadius: "14px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>{s.icon}</div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Aktive Testzuweisungen</h2>
            <button onClick={() => navigate("library")} style={{
              padding: "9px 18px", background: "#2563a8", color: "#fff",
              border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
            }}>📚 Test-Vorlagen</button>
          </div>

          {loading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
          ) : assignments.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>📋</div>
              <div style={{ fontWeight: 600 }}>Noch keine Tests zugewiesen</div>
              <div style={{ fontSize: "13px", marginTop: "4px" }}>Gehe zu „Test-Vorlagen" um einen Test einer Gruppe zuzuweisen.</div>
              <button onClick={() => navigate("library")} style={{ marginTop: "16px", padding: "9px 20px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                Zur Vorlagen-Bibliothek →
              </button>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Test", "Gruppe", "Zeitlimit", "Status", "Aktionen"].map(h => (
                    <th key={h} style={{ padding: "12px 20px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => {
                  const s = STATUS_STYLE[a.status] || STATUS_STYLE.entwurf;
                  const mins = Math.round((a.time_limit || 0) / 60);
                  return (
                    <tr key={a.id} style={{ borderBottom: i < assignments.length - 1 ? "1px solid #f8fafc" : "none" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{a.title}</td>
                      <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>
                        {a.groups?.name || "–"}
                        {a.groups?.subject && <span style={{ color: "#94a3b8", marginLeft: "4px" }}>({a.groups.subject})</span>}
                      </td>
                      <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>
                        {mins > 0 ? `${mins} Min.` : "–"}
                        {a.timing_mode === "window" && a.window_date && (
                          <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                            📅 {new Date(a.window_date).toLocaleDateString("de-DE")} {a.window_start}–{a.window_end}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <span style={{ background: s.bg, color: s.color, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 }}>{s.label}</span>
                        {a.anti_cheat && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#7c3aed" }}>🛡️</span>}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => navigate("results", a)} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#374151" }}>
                            📊 Ergebnisse
                          </button>
                          <button onClick={() => toggleStatus(a.id, a.status)} style={{ padding: "5px 10px", border: `1px solid ${a.status === "aktiv" ? "#fecaca" : "#bbf7d0"}`, borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer", color: a.status === "aktiv" ? "#dc2626" : "#16a34a" }}>
                            {a.status === "aktiv" ? "⏸ Pausieren" : "▶ Aktivieren"}
                          </button>
                          <button onClick={() => setDeleteConfirm(a.id)} style={{ padding: "5px 10px", border: "1px solid #fecaca", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#dc2626" }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "20px" }}>
          <div onClick={() => navigate("groups")} style={{ background: "#fff", borderRadius: "14px", padding: "20px", border: "2px dashed #e2e8f0", cursor: "pointer", textAlign: "center" }}
            onMouseOver={e => e.currentTarget.style.borderColor = "#2563a8"}
            onMouseOut={e => e.currentTarget.style.borderColor = "#e2e8f0"}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>👥</div>
            <div style={{ fontWeight: 600, color: "#374151" }}>Lerngruppen verwalten</div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>{groups.length} Gruppe{groups.length !== 1 ? "n" : ""} vorhanden</div>
          </div>
          <div style={{ background: "linear-gradient(135deg, #1e3a5f, #2563a8)", borderRadius: "14px", padding: "20px", textAlign: "center", opacity: 0.7 }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>🤖</div>
            <div style={{ fontWeight: 600, color: "#fff" }}>KI-Test-Generator</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", marginTop: "4px" }}>Nur Premium · Bald verfügbar</div>
          </div>
        </div>
      </div>

      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "360px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Zuweisung löschen?</h3>
            <p style={{ color: "#64748b", marginBottom: "24px", fontSize: "14px" }}>Die Test-Vorlage bleibt erhalten.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={() => deleteAssignment(deleteConfirm)} style={{ flex: 1, padding: "10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>Löschen</button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
