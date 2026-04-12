import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const STATUS_STYLE = {
  aktiv:   { bg: "#dcfce7", color: "#16a34a", label: "Aktiv" },
  beendet: { bg: "#f1f5f9", color: "#64748b", label: "Beendet" },
  entwurf: { bg: "#fef9c3", color: "#ca8a04", label: "Entwurf" },
};

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
  const [endConfirm, setEndConfirm] = useState(null);
  const [lobbyModal, setLobbyModal] = useState(null);
  const [lobbyStudents, setLobbyStudents] = useState([]);
  const [lobbySubmissions, setLobbySubmissions] = useState([]);
  const [lobbyTimeLeft, setLobbyTimeLeft] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: asgn }, { data: grps }] = await Promise.all([
      supabase.from("assignments").select("*, groups(name, subject, count, usernames)").order("created_at", { ascending: false }),
      supabase.from("groups").select("*"),
    ]);
    setAssignments(asgn || []);
    setGroups(grps || []);
    setLoading(false);
  };

  const endAssignment = async (id) => {
    await supabase.from("assignments").update({ status: "beendet" }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "beendet" } : a));
    setEndConfirm(null);
  };

  const reactivateAssignment = async (id) => {
    await supabase.from("assignments").update({ status: "aktiv" }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: "aktiv" } : a));
  };

  const pauseAssignment = async (id) => {
    const now = new Date().toISOString();
    await supabase.from("assignments").update({ paused_at: now }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, paused_at: now } : a));
  };

  const resumeAssignment = async (id) => {
    await supabase.from("assignments").update({ paused_at: null }).eq("id", id);
    setAssignments(prev => prev.map(a => a.id === id ? { ...a, paused_at: null } : a));
  };

  const deleteAssignment = async (id) => {
    await supabase.from("assignments").delete().eq("id", id);
    setAssignments(prev => prev.filter(a => a.id !== id));
    setDeleteConfirm(null);
  };

  const openLobby = async (assignment) => {
    setLobbyModal(assignment);
    setLobbyStudents([]);
    const cutoff = new Date(Date.now() - 12000).toISOString();
    const { data } = await supabase
      .from("lobby_presence")
      .select("username")
      .eq("assignment_id", assignment.id)
      .gte("last_seen", cutoff);
    setLobbyStudents((data || []).map(d => d.username));
  };

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
    const confirmed = window.confirm(
      "Lobby zurücksetzen?\n\nDadurch werden alle Abgaben dieses Tests gelöscht, sodass Schüler ihn erneut machen können.\n\nFortfahren?"
    );
    if (!confirmed) return;
    await supabase.from("assignments").update({ lobby_started_at: null }).eq("id", lobbyModal.id);
    await supabase.from("lobby_presence").delete().eq("assignment_id", lobbyModal.id);
    await supabase.from("submissions").delete().eq("assignment_id", lobbyModal.id);
    setAssignments(prev => prev.map(a => a.id === lobbyModal.id ? { ...a, lobby_started_at: null } : a));
    setLobbyModal(prev => ({ ...prev, lobby_started_at: null }));
    setLobbyStudents([]);
    setLobbySubmissions([]);
    setLobbyTimeLeft(null);
  };

  const appUrl = "https://quickest.lovable.app?role=student";
  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  useEffect(() => {
    if (!lobbyModal) return;
    const tick = async () => {
      const cutoff = new Date(Date.now() - 12000).toISOString();
      const [{ data: presence }, { data: subs }] = await Promise.all([
        supabase.from("lobby_presence").select("username").eq("assignment_id", lobbyModal.id).gte("last_seen", cutoff),
        supabase.from("submissions").select("username").eq("assignment_id", lobbyModal.id),
      ]);
      const unique = [...new Set((presence || []).map(d => d.username))];
      setLobbyStudents(unique);
      setLobbySubmissions((subs || []).map(s => s.username));
      if (lobbyModal.lobby_started_at) {
        const elapsed = Math.floor((Date.now() - new Date(lobbyModal.lobby_started_at).getTime()) / 1000);
        const remaining = Math.max(0, (lobbyModal.time_limit || 1200) - elapsed);
        setLobbyTimeLeft(remaining);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lobbyModal]);

  const stats = [
    { label: "Tests gesamt", value: assignments.length, icon: "📋", color: "#2563a8" },
    { label: "Aktive Tests", value: assignments.filter(a => a.status === "aktiv").length, icon: "🟢", color: "#16a34a" },
    { label: "Lerngruppen", value: groups.length, icon: "👥", color: "#7c3aed" },
    { label: "Abgeschlossen", value: assignments.filter(a => a.status === "beendet").length, icon: "✅", color: "#64748b" },
  ];

  // Sort: parents first, children below
  const getSorted = () => {
    const parents = assignments.filter(a => !a.parent_assignment_id);
    const children = assignments.filter(a => !!a.parent_assignment_id);
    const sorted = [];
    parents.forEach(p => {
      sorted.push({ ...p, isChild: false });
      children.filter(c => c.parent_assignment_id === p.id).forEach(c => sorted.push({ ...c, isChild: true }));
    });
    children.filter(c => !parents.find(p => p.id === c.parent_assignment_id)).forEach(c => sorted.push({ ...c, isChild: true }));
    return sorted;
  };

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
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Testzuweisungen</h2>
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
                {getSorted().map((a, i, arr) => {
                  const s = STATUS_STYLE[a.status] || STATUS_STYLE.entwurf;
                  const mins = Math.round((a.time_limit || 0) / 60);
                  const isLobby = a.timing_mode === "lobby";
                  const lobbyStarted = isLobby && !!a.lobby_started_at;
                  const isEnded = a.status === "beendet";
                  return (
                    <tr key={a.id} style={{ borderBottom: i < arr.length - 1 ? "1px solid #f8fafc" : "none", background: isEnded ? "#f8fafc" : a.isChild ? "#fafbff" : "transparent", opacity: isEnded ? 0.75 : 1 }}>
                      <td style={{ padding: a.isChild ? "10px 20px 10px 40px" : "14px 20px", fontWeight: 600, fontSize: "14px", color: a.isChild ? "#4b5563" : "#0f172a" }}>
                        {a.isChild && <span style={{ color: "#94a3b8", marginRight: "8px", fontSize: "16px" }}>↳</span>}
                        {a.title}
                        {a.isChild && <span style={{ marginLeft: "6px", fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>Nachtest</span>}
                      </td>
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
                        {a.paused_at && <span style={{ marginLeft: "6px", fontSize: "11px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>⏸ Pause</span>}
                        {a.anti_cheat && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#7c3aed" }}>🛡️</span>}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {isLobby && !isEnded && (
                            <button onClick={() => openLobby(a)} style={{ padding: "5px 10px", border: "1px solid #e9d5ff", borderRadius: "7px", background: "#f5f3ff", fontSize: "12px", cursor: "pointer", color: "#6d28d9", fontWeight: 600 }}>
                              🎮 Lobby
                            </button>
                          )}
                          <button onClick={() => navigate("results", a)} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer", color: "#374151" }}>
                            📊 Ergebnisse
                          </button>
                          {isEnded ? (
                            <button onClick={() => reactivateAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #bbf7d0", borderRadius: "7px", background: "#f0fdf4", fontSize: "12px", cursor: "pointer", color: "#16a34a", fontWeight: 600 }}>
                              ▶ Reaktivieren
                            </button>
                          ) : a.paused_at ? (
                            <button onClick={() => resumeAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #bbf7d0", borderRadius: "7px", background: "#f0fdf4", fontSize: "12px", cursor: "pointer", color: "#16a34a", fontWeight: 600 }}>
                              ▶ Fortsetzen
                            </button>
                          ) : (
                            <button onClick={() => pauseAssignment(a.id)} style={{ padding: "5px 10px", border: "1px solid #bfdbfe", borderRadius: "7px", background: "#eff6ff", fontSize: "12px", cursor: "pointer", color: "#2563a8", fontWeight: 600 }}>
                              ⏸ Pausieren
                            </button>
                          )}
                          {!isEnded && (
                            <button onClick={() => setEndConfirm(a)} style={{ padding: "5px 10px", border: "1px solid #fde68a", borderRadius: "7px", background: "#fefce8", fontSize: "12px", cursor: "pointer", color: "#92400e", fontWeight: 600 }}>
                              ✓ Beenden
                            </button>
                          )}
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
          <div style={{ background: "#fff", borderRadius: "24px", padding: "32px", maxWidth: "640px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#6d28d9", marginBottom: "4px" }}>🎮 LOBBY</div>
                <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{lobbyModal.title}</h2>
                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>{lobbyModal.groups?.name}</div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {lobbyModal.lobby_started_at && lobbyTimeLeft !== null && (
                  <div style={{ textAlign: "center", background: lobbyTimeLeft < 120 ? "#fef2f2" : "#f0fdf4", borderRadius: "12px", padding: "8px 16px", border: `1px solid ${lobbyTimeLeft < 120 ? "#fecaca" : "#bbf7d0"}` }}>
                    <div style={{ fontSize: "24px", fontWeight: 900, color: lobbyTimeLeft < 120 ? "#dc2626" : "#16a34a", fontVariantNumeric: "tabular-nums" }}>{formatTime(lobbyTimeLeft)}</div>
                    <div style={{ fontSize: "11px", color: "#64748b" }}>Restzeit</div>
                  </div>
                )}
                <button onClick={() => setLobbyModal(null)} style={{ background: "#f1f5f9", border: "none", borderRadius: "8px", padding: "8px 12px", cursor: "pointer", fontSize: "13px", color: "#374151" }}>✕</button>
              </div>
            </div>

            {!lobbyModal.lobby_started_at ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
                <div style={{ background: "#f8fafc", borderRadius: "16px", padding: "20px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px" }}>
                    {lobbyModal.require_seb ? "🔒 QR-Code für SEB" : "📱 QR-Code für Schüler"}
                  </div>
                  <QRCode url={appUrl} size={140} />
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "8px" }}>
                    {lobbyModal.require_seb ? "Schüler ohne SEB werden zur Installation weitergeleitet" : "Schüler scannen → einloggen → warten"}
                  </div>
                  {lobbyModal.require_seb && (
                    <div style={{ marginTop: "8px", background: "#f5f3ff", borderRadius: "8px", padding: "6px 10px", fontSize: "11px", color: "#6d28d9", fontWeight: 600 }}>🔒 SEB erforderlich</div>
                  )}
                </div>
                <div style={{ background: "#f8fafc", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "12px" }}>
                    👥 Warteraum ({lobbyStudents.length} / {lobbyModal.makeup_usernames?.length || lobbyModal.groups?.count || "?"})
                  </div>
                  {lobbyStudents.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "#94a3b8", textAlign: "center", paddingTop: "20px" }}>
                      <div style={{ fontSize: "28px", marginBottom: "8px" }}>⏳</div>Noch niemand da...
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "160px", overflowY: "auto" }}>
                      {lobbyStudents.map((name, i) => (
                        <div key={i} style={{ background: "#dcfce7", borderRadius: "8px", padding: "6px 12px", fontSize: "13px", fontWeight: 600, color: "#16a34a", display: "flex", alignItems: "center", gap: "6px" }}>✓ {name}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: "20px" }}>
                {(() => {
                  const totalCount = lobbyModal.makeup_usernames?.length || lobbyModal.groups?.count || 0;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>📊 {lobbySubmissions.length} / {totalCount} abgegeben</div>
                      <div style={{ height: "8px", flex: 1, margin: "0 12px", background: "#e2e8f0", borderRadius: "8px" }}>
                        <div style={{ height: "8px", borderRadius: "8px", background: "#16a34a", width: `${totalCount ? (lobbySubmissions.length / totalCount) * 100 : 0}%`, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })()}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", maxHeight: "240px", overflowY: "auto" }}>
                  {(lobbyModal.makeup_usernames?.length ? lobbyModal.makeup_usernames : (lobbyModal.groups?.usernames || [])).map((name, i) => {
                    const submitted = lobbySubmissions.includes(name);
                    const active = lobbyStudents.includes(name);
                    return (
                      <div key={i} style={{ borderRadius: "8px", padding: "8px 10px", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px",
                        background: submitted ? "#dcfce7" : active ? "#fef9c3" : "#f8fafc",
                        color: submitted ? "#16a34a" : active ? "#92400e" : "#94a3b8",
                        border: `1px solid ${submitted ? "#bbf7d0" : active ? "#fde68a" : "#e2e8f0"}` }}>
                        <span>{submitted ? "✅" : active ? "✍️" : "⏳"}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "12px", marginTop: "10px", fontSize: "12px", color: "#64748b" }}>
                  <span>✅ Abgegeben</span><span>✍️ Schreibt noch</span><span>⏳ Nicht eingeloggt</span>
                </div>
              </div>
            )}

            {!lobbyModal.lobby_started_at ? (
              <button onClick={startLobby} disabled={starting || lobbyStudents.length === 0}
                style={{ width: "100%", padding: "16px", background: lobbyStudents.length > 0 ? "#16a34a" : "#e2e8f0", color: lobbyStudents.length > 0 ? "#fff" : "#94a3b8", border: "none", borderRadius: "12px", fontWeight: 800, fontSize: "16px", cursor: lobbyStudents.length > 0 ? "pointer" : "not-allowed" }}>
                {starting ? "Wird gestartet..." : lobbyStudents.length === 0 ? "Warte auf Schüler..." : `🚀 Test jetzt starten (${lobbyStudents.length} Schüler)`}
              </button>
            ) : (
              <button onClick={resetLobby} style={{ width: "100%", padding: "12px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
                🔄 Lobby zurücksetzen
              </button>
            )}
          </div>
        </div>
      )}

      {/* END confirm modal */}
      {endConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "380px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Test beenden?</h3>
            <p style={{ color: "#64748b", marginBottom: "6px", fontSize: "14px" }}>
              <strong>„{endConfirm.title}"</strong> wird als abgeschlossen archiviert.
            </p>
            <p style={{ color: "#94a3b8", marginBottom: "24px", fontSize: "13px" }}>
              Schüler können den Test nicht mehr bearbeiten. Ergebnisse und Abgaben bleiben erhalten. Du kannst ihn jederzeit reaktivieren.
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setEndConfirm(null)} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={() => endAssignment(endConfirm.id)} style={{ flex: 1, padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>✓ Beenden</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "360px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Zuweisung löschen?</h3>
            <p style={{ color: "#64748b", marginBottom: "24px", fontSize: "14px" }}>Alle Abgaben und Ergebnisse werden unwiderruflich gelöscht. Die Test-Vorlage bleibt erhalten.</p>
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
