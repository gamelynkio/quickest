import { useState, useEffect } from "react";
const useIsMobile = () => { const [m, setM] = useState(window.innerWidth < 768); useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []); return m; };
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const STATUS_STYLE = {
  aktiv:       { bg: "#dcfce7", color: "#16a34a", label: "Aktiv" },
  beendet:     { bg: "#f1f5f9", color: "#64748b", label: "Beendet" },
  archiviert:  { bg: "#f3f4f6", color: "#9ca3af", label: "Archiviert" },
  entwurf:     { bg: "#fef9c3", color: "#ca8a04", label: "Entwurf" },
};

export default function TeacherDashboard({ currentUser, navigate }) {
  const [assignments, setAssignments] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, groups: 0, done: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => { if (currentUser?.id) fetchAll(); }, [currentUser?.id]);

  const fetchAll = async () => {
    if (!currentUser?.id) return;
    const { data } = await supabase
      .from("assignments")
      .select("*, groups(name, subject, count)")
      .eq("teacher_id", currentUser.id)
      .order("created_at", { ascending: false });
    setAssignments(data || []);
    const active = (data || []).filter(a => a.status === "aktiv").length;
    const done = (data || []).filter(a => a.status === "beendet").length;
    const groups = new Set((data || []).map(a => a.group_id)).size;
    setStats({ total: (data || []).length, active, groups, done });
  };

  const endAssignment = async (id) => {
    const endedAt = new Date().toISOString();
    await supabase.from("assignments").update({ status: "beendet", lobby_end_at: endedAt }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "beendet", lobby_end_at: endedAt } : a));
  };

  const reactivateAssignment = async (id) => {
    await supabase.from("assignments").update({ status: "aktiv", lobby_started_at: null, lobby_end_at: null, paused_at: null }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "aktiv", lobby_started_at: null, lobby_end_at: null, paused_at: null } : a));
  };

  const archiveAssignment = async (id) => {
    await supabase.from("assignments").update({ status: "archiviert" }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "archiviert" } : a));
  };

  const unarchiveAssignment = async (id) => {
    await supabase.from("assignments").update({ status: "beendet", lobby_started_at: null, lobby_end_at: null }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "beendet" } : a));
  };

  const deleteAssignment = async (id) => {
    await supabase.from("submissions").delete().eq("assignment_id", id);
    await supabase.from("assignments").delete().eq("id", id);
    setAssignments(prev => prev.filter(a => a.id !== id));
    setDeleteConfirm(null);
  };

  const getSorted = () => {
    const visible = assignments.filter(a => showArchived ? a.status === "archiviert" : a.status !== "archiviert");
    const parents = visible.filter(a => !a.parent_assignment_id);
    const children = visible.filter(a => !!a.parent_assignment_id);
    const result = [];
    parents.forEach(p => {
      result.push({ ...p, isChild: false });
      children.filter(c => c.parent_assignment_id === p.id).forEach(c => result.push({ ...c, isChild: true }));
    });
    children.filter(c => !parents.find(p => p.id === c.parent_assignment_id)).forEach(c => result.push({ ...c, isChild: true }));
    return result;
  };

  return (
    <TeacherLayout currentUser={currentUser} navigate={navigate}>
      <div style={{ padding: isMobile ? "16px 12px 0" : "32px 32px 0" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", marginBottom: "4px" }}>
          Willkommen, {currentUser.name || currentUser.email?.split("@")[0]} 👋
        </h1>
        <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>Hier ist deine Übersicht.</p>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
          {[
            { icon: "📋", val: stats.total, label: "Tests gesamt" },
            { icon: "🟢", val: stats.active, label: "Aktive Tests" },
            { icon: "👥", val: stats.groups, label: "Lerngruppen" },
            { icon: "✅", val: stats.done, label: "Abgeschlossen" },
          ].map(s => (
            <div key={s.label} style={{ background: "#fff", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "28px", marginBottom: "4px" }}>{s.icon}</div>
              <div style={{ fontSize: "28px", fontWeight: 800, color: "#0f172a" }}>{s.val}</div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Assignments table */}
      <div style={{ padding: isMobile ? "0 12px 16px" : "0 32px 32px" }}>
        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Testzuweisungen</h2>
              <button onClick={() => setShowArchived(v => !v)} style={{ padding: "5px 12px", background: showArchived ? "#f3f4f6" : "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                {showArchived ? "📂 Archiv" : "📁 Archiv"}
              </button>
            </div>
            <button onClick={() => navigate("library")} style={{ padding: "9px 18px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>📚 Test-Vorlagen</button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {(isMobile ? ["Test", "Aktionen"] : ["Test", "Gruppe", "Status", "Aktionen"]).map(h => (
                  <th key={h} style={{ padding: "12px 20px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#64748b", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {getSorted().length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "40px", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}>Noch keine Tests. Erstelle deinen ersten Test über „Test-Vorlagen".</td></tr>
              ) : getSorted().map((a, i, arr) => {
                const isEnded = a.status === "beendet";
                const isArchived = a.status === "archiviert";
                const st = STATUS_STYLE[a.status] || STATUS_STYLE.entwurf;
                return (
                  <tr key={a.id} style={{ borderBottom: i < arr.length - 1 ? "1px solid #f8fafc" : "none", background: a.isChild ? "#fafbff" : "transparent", opacity: isArchived ? 0.6 : isEnded ? 0.85 : 1 }}>
                    <td style={{ padding: a.isChild ? "13px 20px 13px 40px" : "13px 20px" }}>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
                        {a.isChild && <span style={{ color: "#94a3b8" }}>↳</span>}
                        {a.title}
                        {a.isChild && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>Nachtest</span>}
                      </div>
                    </td>
                    {!isMobile && <td style={{ padding: "13px 20px", fontSize: "13px", color: "#2563a8", fontWeight: 500 }}>{a.groups?.name || "–"}</td>}
                    {!isMobile && <td style={{ padding: "13px 20px" }}>
                      <span style={{ background: st.bg, color: st.color, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 }}>{st.label}</span>
                    </td>}
                    <td style={{ padding: "13px 20px" }}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" }}>
                        {/* Drucken */}
                        <button onClick={() => navigate("testPrint", a)} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#f8fafc", fontSize: "12px", cursor: "pointer", color: "#374151" }}>
                          🖨️ Drucken
                        </button>
                        {/* Ergebnisse */}
                        <button onClick={() => navigate("results", a)} style={{ padding: "5px 10px", border: "1px solid #bfdbfe", borderRadius: "7px", background: "#eff6ff", fontSize: "12px", cursor: "pointer", color: "#2563a8", fontWeight: 600 }}>
                          📊 Ergebnisse
                        </button>
                        {/* Status-Aktionen */}
                        {isArchived ? (
                          <button onClick={() => unarchiveAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#f8fafc", fontSize: "12px", cursor: "pointer", color: "#64748b", fontWeight: 600 }}>📂 Wiederherstellen</button>
                        ) : isEnded ? (
                          <>
                            <button onClick={() => reactivateAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #bbf7d0", borderRadius: "7px", background: "#f0fdf4", fontSize: "12px", cursor: "pointer", color: "#16a34a", fontWeight: 600 }}>▶ Reaktivieren</button>
                            <button onClick={() => archiveAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#f8fafc", fontSize: "12px", cursor: "pointer", color: "#94a3b8", fontWeight: 600 }}>📁 Archivieren</button>
                          </>
                        ) : (
                          <button onClick={() => endAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #fde68a", borderRadius: "7px", background: "#fffbeb", fontSize: "12px", cursor: "pointer", color: "#d97706", fontWeight: 600 }}>✓ Beenden</button>
                        )}
                        {/* Löschen */}
                        <button onClick={() => setDeleteConfirm(a.id)} style={{ padding: "5px 8px", border: "1px solid #fecaca", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#dc2626" }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Archiv */}
        {assignments.some(a => a.status === "archiviert") && !showArchived && (
          <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden", marginTop: "20px" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>📁</span>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#64748b" }}>Archiv</h3>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>— archivierte Tests</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Test", "Zeitraum", "Aktionen"].map(h => (
                    <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const fmt = (iso) => iso ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
                  const archived = assignments.filter(a => a.status === "archiviert");
                  const parents = archived.filter(a => !a.parent_assignment_id).sort((a, b) => new Date(b.lobby_started_at || b.created_at) - new Date(a.lobby_started_at || a.created_at));
                  const children = archived.filter(a => !!a.parent_assignment_id);
                  const sorted = [];
                  parents.forEach(p => {
                    sorted.push({ ...p, isChild: false });
                    children.filter(c => c.parent_assignment_id === p.id).forEach(c => sorted.push({ ...c, isChild: true }));
                  });
                  return sorted.map((a, i, arr) => (
                    <tr key={a.id} style={{ borderBottom: i < arr.length - 1 ? "1px solid #f8fafc" : "none", opacity: 0.75, background: a.isChild ? "#fafbff" : "transparent" }}>
                      <td style={{ padding: a.isChild ? "12px 20px 12px 40px" : "12px 20px" }}>
                        <div style={{ fontWeight: 600, fontSize: "13px", color: "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
                          {a.isChild && <span style={{ color: "#94a3b8" }}>↳</span>}
                          {a.title}
                          {a.isChild && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>Nachtest</span>}
                        </div>
                        <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "3px" }}>{a.groups?.name || "–"}</div>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ fontSize: "12px", color: "#64748b" }}><span style={{ color: "#94a3b8" }}>Start:</span> {fmt(a.lobby_started_at)}</div>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}><span style={{ color: "#94a3b8" }}>Ende:</span> {fmt(a.lobby_end_at)}</div>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => navigate("results", a)} style={{ padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#374151" }}>📊 Ergebnisse</button>
                          <button onClick={() => unarchiveAssignment(a.id)} style={{ padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", background: "#f8fafc", fontSize: "12px", cursor: "pointer", color: "#64748b", fontWeight: 600 }}>📂 Wiederherstellen</button>
                          <button onClick={() => setDeleteConfirm(a.id)} style={{ padding: "4px 10px", border: "1px solid #fecaca", borderRadius: "6px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#dc2626" }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        )}

        {/* Quick Actions — nur auf Desktop */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "20px" }}
          className="desktop-only">
          <style>{`@media (max-width: 768px) { .desktop-only { display: none !important; } }`}</style>
          <button onClick={() => navigate("groups")} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "24px", textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>👥</div>
            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>Lerngruppen verwalten</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>{stats.groups} Gruppen vorhanden</div>
          </button>
          <button onClick={() => navigate("ai-generator")} style={{ background: "linear-gradient(135deg, #2563a8, #7c3aed)", border: "none", borderRadius: "16px", padding: "24px", textAlign: "center", cursor: "pointer", color: "#fff" }}>
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>🤖</div>
            <div style={{ fontWeight: 700, marginBottom: "4px" }}>KI-Test-Generator</div>
            <div style={{ fontSize: "12px", opacity: 0.8 }}>Tests automatisch erstellen</div>
          </button>
        </div>
      </div>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "16px", padding: "28px", maxWidth: "360px", width: "100%", margin: "20px" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "17px", fontWeight: 800 }}>Test löschen?</h3>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "20px" }}>Alle Abgaben und Ergebnisse werden unwiderruflich gelöscht.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={() => deleteAssignment(deleteConfirm)} style={{ flex: 1, padding: "11px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>Ja, löschen</button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
