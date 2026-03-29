import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

export default function StudentDashboard({ currentUser, onStartTest, onLogout }) {
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: asgn }, { data: subs }] = await Promise.all([
      supabase.from("assignments").select("*").eq("group_id", currentUser.group_id).eq("status", "aktiv"),
      supabase.from("submissions").select("*, assignments(title, time_limit)").eq("student_id", currentUser.id).order("submitted_at", { ascending: false }),
    ]);
    setAssignments(asgn || []);
    setSubmissions(subs || []);
    setLoading(false);
  };

  const submittedIds = new Set(submissions.map(s => s.assignment_id));

  const pending = assignments.filter(a => {
    if (submittedIds.has(a.id)) return false;
    if (a.timing_mode === "lobby") return !!a.lobby_started_at;
    return true;
  });

  const waiting = assignments.filter(a =>
    !submittedIds.has(a.id) && a.timing_mode === "lobby" && !a.lobby_started_at
  );

  const timeLabel = (a) => {
    const mins = Math.round((a.time_limit || 0) / 60);
    if (a.timing_mode === "lobby") return "🎮 Lobby";
    if (a.timing_mode === "window" && a.window_date) return `📅 ${new Date(a.window_date).toLocaleDateString("de-DE")} ${a.window_start}–${a.window_end}`;
    return mins > 0 ? `⏱ ${mins} Min.` : "";
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1e3a5f 0%, #2563a8 50%, #1e3a5f 100%)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ maxWidth: "500px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", paddingTop: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "24px" }}>⚡</span>
            <div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#fff" }}>QuickTest</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)" }}>{currentUser.username}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}>
            Abmelden
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.7)", padding: "48px" }}>Wird geladen...</div>
        ) : (
          <>
            {/* Lobby waiting */}
            {waiting.length > 0 && (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "1px", marginBottom: "10px" }}>WARTERAUM</div>
                {waiting.map(a => (
                  <div key={a.id} style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "18px 20px", marginBottom: "10px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", marginBottom: "12px" }}>🎮 Lobby — warte auf Lehrkraft</div>
                    <button onClick={() => onStartTest(a)} style={{ width: "100%", padding: "12px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
                      In Warteraum gehen →
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Active tests */}
            {pending.length > 0 && (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "1px", marginBottom: "10px" }}>JETZT VERFÜGBAR</div>
                {pending.map(a => (
                  <div key={a.id} style={{ background: "rgba(255,255,255,0.12)", borderRadius: "16px", padding: "18px 20px", marginBottom: "10px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", marginBottom: "12px" }}>{timeLabel(a)}</div>
                    <button onClick={() => onStartTest(a)} style={{ width: "100%", padding: "14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>
                      Test starten →
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {pending.length === 0 && waiting.length === 0 && (
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "16px", padding: "40px", textAlign: "center", marginBottom: "20px" }}>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>📭</div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: "16px" }}>Kein aktiver Test</div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "13px", marginTop: "6px" }}>Deine Lehrkraft hat aktuell keinen Test für dich.</div>
              </div>
            )}

            {/* Completed tests */}
            {submissions.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "1px", marginBottom: "10px" }}>ABSOLVIERT</div>
                {submissions.map(s => {
                  const percent = s.total_points > 0 ? Math.round((s.score / s.total_points) * 100) : 0;
                  return (
                    <div key={s.id} style={{ background: "rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px 20px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "15px", color: "#fff" }}>{s.assignments?.title || "Test"}</div>
                        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                          {new Date(s.submitted_at).toLocaleDateString("de-DE")} · {s.score ?? "–"}/{s.total_points} Pkt. · {percent}%
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "12px" }}>
                        {s.grade ? (
                          <div style={{ fontSize: "28px", fontWeight: 900, color: GRADE_COLOR[s.grade] || "#fff" }}>{s.grade}</div>
                        ) : (
                          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>wird<br/>bewertet</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
