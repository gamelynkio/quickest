import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const STATUS_STYLE = {
  aktiv:   { bg: "#dcfce7", color: "#16a34a", label: "Aktiv" },
  beendet: { bg: "#f1f5f9", color: "#64748b", label: "Beendet" },
  entwurf: { bg: "#fef9c3", color: "#ca8a04", label: "Entwurf" },
};

// Simple QR code using a free API
const QRCode = ({ url, size = 140 }) => (
  <img
    src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=1e3a5f&margin=8`}
    alt="QR-Code"
    style={{ width: size, height: size, borderRadius: "10px", border: "2px solid #e2e8f0" }}
  />
);

export default function TeacherDashboard({ navigate, onLogout, currentUser }) {
  const [assignments, setAssignments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [lobbyModal, setLobbyModal] = useState(null); // assignment in lobby view
  const [lobbyStudents, setLobbyStudents] = useState([]);
  const [starting, setStarting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: asgn }, { data: grps }] = await Promise.all([
      supabase.from("assignments").select("*, groups(name, subject, count)").order("created_at", { ascending: false }),
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

  // Open lobby view + subscribe to realtime presence
  const openLobby = async (assignment) => {
    setLobbyModal(assignment);
    setLobbyStudents([]);

    // Fetch students already in lobby (submitted lobby_joined event)
    const { data } = await supabase
      .from("lobby_presence")
      .select("username")
      .eq("assignment_id", assignment.id);
    setLobbyStudents((data || []).map(d => d.username));
  };

  // Subscribe to lobby_presence realtime when modal is open
  useEffect(() => {
    if (!lobbyModal) return;
    const channel = supabase
      .channel(`lobby-${lobbyModal.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "lobby_presence",
        filter: `assignment_id=eq.${lobbyModal.id}`
      }, async () => {
        const { data } = await supabase
          .from("lobby_presence").select("username").eq("assignment_id", lobbyModal.id);
        setLobbyStudents((data || []).map(d => d.username));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [lobbyModal]);

  const startLobby = async () => {
    if (!lobbyModal || starting) return;
    setStarting(true);
    const now = new Date().toISOString();
    await supabase.from("assignments").update({ lobby_started_at: now }).eq("id", lobbyModal.id);
    setAssignments(prev => prev.map(a => a.id === lobbyModal.id ? { ...a, lobby_started_at: now } : a));
    setLobbyModal(prev => ({ ...prev, lobby_started_at: now }));
    setStarting(false);
  };

  const resetLobby = async () => {
    if (!lobbyModal) return;
    await supabase.from("assignments").update({ lobby_started_at: null }).eq("id", lobbyModal.id);
    await supabase.from("lobby_presence").delete().eq("assignment_id", lobbyModal.id);
    setAssignments(prev => prev.map(a => a.id === lobbyModal.id ? { ...a, lobby_started_at: null } : a));
    setLobbyModal(prev => ({ ...prev, lobby_started_at: null }));
    setLobbyStudents([]);
  };

  const appUrl = "https://quickest.lovable.app";

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

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: "#fff", borderRadius: "14px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>{s.icon}</div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Assignments table */}
        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Aktive Testzuweisungen</h2>
            <button onClick={() => navigate("library")} style={{ padding: "9px 18px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>📚 Test-Vorlagen</button>
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
                  {["Test", "Gruppe", "Modus", "Status", "Aktionen"].map(h => (
                    <th key={h} style={{ padding: "12px 20px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map((a, i) => {
                  const s = STATUS_STYLE[a.status] || STATUS_STYLE.entwurf;
                  const mins = Math.round((a.time_limit || 0) / 60);
                  const isLobby = a.timing_mode === "lobby";
                  const lobbyStarted = isLobby && !!a.lobby_started_at;
                  return (
                    <tr key={a.id} style={{ borderBottom: i < assignments.length - 1 ? "1px solid #f8fafc" : "none" }}>
                      <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{a.title}</td>
                      <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>
                        {a.groups?.name || "–"}
                        {a.groups?.subject && <span style={{ color: "#94a3b8", marginLeft: "4px" }}>({a.groups.subject})</span>}
                      </td>
                      <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>
                        {isLobby ? (
                          <span style={{ background: "#f5f3ff", color: "#6d28d9", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>
                            🎮 Lobby{lobbyStarted ? " · Gestartet" : " · Wartet"}
                          </span>
                        ) : (
                          <>
                            {mins > 0 ? `${mins} Min.` : "–"}
                            {a.timing_mode === "window" && a.window_date && (
                              <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                                📅 {new Date(a.window_date).toLocaleDateString("de-DE")} {a.window_start}–{a.window_end}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <span style={{ background: s.bg, color: s.color, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 }}>{s.label}</span>
                        {a.anti_cheat && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#7c3aed" }}>🛡️</span>}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {isLobby && a.status === "aktiv" && (
                            <button onClick={() => openLobby(a)} style={{ padding: "5px 10px", border: "1px solid #e9d5ff", borderRadius: "7px", background: "#f5f3ff", fontSize: "12px", cursor: "pointer", color: "#6d28d9", fontWeight: 600 }}>
                              🎮 Lobby
                            </button>
                          )}
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

      {/* LOBBY MODAL */}
      {lobbyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "24px", padding: "32px", maxWidth: "600px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#6d28d9", marginBottom: "4px" }}>🎮 LOBBY</div>
                <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{lobbyModal.title}</h2>
                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>{lobbyModal.groups?.name}</div>
              </div>
              <button onClick={() => setLobbyModal(null)} style={{ background: "#f1f5f9", border: "none", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", color: "#374151" }}>✕ Schließen</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
              {/* QR Code */}
              <div style={{ background: "#f8fafc", borderRadius: "16px", padding: "20px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px" }}>📱 QR-Code für Schüler</div>
                <QRCode url={appUrl} size={150} />
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "10px" }}>{appUrl}</div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>Schüler scannen → einloggen → warten</div>
              </div>

              {/* Students in lobby */}
              <div style={{ background: "#f8fafc", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px" }}>
                  👥 In der Lobby ({lobbyStudents.length} / {lobbyModal.groups?.count || "?"})
                </div>
                {lobbyStudents.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "#94a3b8", textAlign: "center", paddingTop: "20px" }}>
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>⏳</div>
                    Noch niemand da...
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "160px", overflowY: "auto" }}>
                    {lobbyStudents.map((name, i) => (
                      <div key={i} style={{ background: "#dcfce7", borderRadius: "8px", padding: "6px 12px", fontSize: "13px", fontWeight: 600, color: "#16a34a", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>✓</span> {name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Start / Reset */}
            {!lobbyModal.lobby_started_at ? (
              <button onClick={startLobby} disabled={starting || lobbyStudents.length === 0}
                style={{ width: "100%", padding: "16px", background: lobbyStudents.length > 0 ? "#16a34a" : "#e2e8f0", color: lobbyStudents.length > 0 ? "#fff" : "#94a3b8", border: "none", borderRadius: "12px", fontWeight: 800, fontSize: "16px", cursor: lobbyStudents.length > 0 ? "pointer" : "not-allowed" }}>
                {starting ? "Wird gestartet..." : lobbyStudents.length === 0 ? "Warte auf Schüler..." : `🚀 Test jetzt starten (${lobbyStudents.length} Schüler)`}
              </button>
            ) : (
              <div>
                <div style={{ background: "#dcfce7", borderRadius: "12px", padding: "14px", textAlign: "center", marginBottom: "12px", color: "#16a34a", fontWeight: 700, fontSize: "15px" }}>
                  ✅ Test läuft — alle Schüler in der Lobby haben gestartet
                </div>
                <button onClick={resetLobby} style={{ width: "100%", padding: "12px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
                  🔄 Lobby zurücksetzen
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm */}
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
