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
      supabase.from("submissions")
        .select("*, assignments(title)")
        .eq("student_id", currentUser.id)
        .order("submitted_at", { ascending: false }),
    ]);

    // Filter out makeup tests where this student already submitted the original
    const submittedAssignmentIds = new Set((subs || []).map(s => String(s.assignment_id)));
    const filteredAssignments = (asgn || []).filter(a => {
      // Makeup test: only show if student hasn't submitted the parent assignment
      if (a.parent_assignment_id) {
        return !submittedAssignmentIds.has(String(a.parent_assignment_id));
      }
      return true;
    });

    setAssignments(filteredAssignments);
    setSubmissions(subs || []);
    setLoading(false);
  };

  const submittedIds = new Set(submissions.map(s => String(s.assignment_id)));

  // Lobby tests waiting for teacher to start
  const lobbyWaiting = assignments.filter(a =>
    !submittedIds.has(String(a.id)) && a.timing_mode === "lobby" && !a.lobby_started_at
  );

  // Tests the student can start right now
  const active = assignments.filter(a => {
    if (submittedIds.has(String(a.id))) return false;
    if (a.timing_mode === "lobby") return !!a.lobby_started_at;
    if (a.timing_mode === "window") {
      if (!a.window_date || !a.window_start || !a.window_end) return false;
      const now = new Date();
      const start = new Date(`${a.window_date}T${a.window_start}`);
      const end = new Date(`${a.window_date}T${a.window_end}`);
      return now >= start && now <= end;
    }
    return true; // countdown
  });

  // Tests coming up but not yet open (window not started)
  const upcoming = assignments.filter(a => {
    if (submittedIds.has(String(a.id))) return false;
    if (a.timing_mode === "lobby" && !a.lobby_started_at) return false; // shown in lobbyWaiting
    if (a.timing_mode === "window" && a.window_date) {
      const start = new Date(`${a.window_date}T${a.window_start}`);
      return new Date() < start;
    }
    return false;
  });

  const timeLabel = (a) => {
    const mins = Math.round((a.time_limit || 0) / 60);
    if (a.timing_mode === "window" && a.window_date)
      return `${new Date(a.window_date).toLocaleDateString("de-DE")} · ${a.window_start}–${a.window_end} Uhr`;
    return mins > 0 ? `${mins} Min.` : "";
  };

  const Section = ({ title, icon, color, children, count }) => (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "0.5px" }}>{title}</span>
        <span style={{ background: color, color: "#fff", borderRadius: "12px", padding: "1px 8px", fontSize: "11px", fontWeight: 700 }}>{count}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1e3a5f 0%, #2563a8 50%, #1e3a5f 100%)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px 16px 40px" }}>
      <div style={{ maxWidth: "500px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px", paddingTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "26px" }}>⚡</span>
            <div>
              <div style={{ fontSize: "19px", fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>QuickTest</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>{currentUser.username}</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.8)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}>
            Abmelden
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", padding: "48px" }}>Wird geladen...</div>
        ) : (
          <>
            {/* LOBBY WAITING */}
            {lobbyWaiting.length > 0 && (
              <Section title="WARTERAUM" icon="🎮" color="#6d28d9" count={lobbyWaiting.length}>
                {lobbyWaiting.map(a => (
                  <div key={a.id} style={{ background: "rgba(109,40,217,0.2)", borderRadius: "16px", padding: "18px 20px", marginBottom: "10px", border: "1px solid rgba(109,40,217,0.4)" }}>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", marginBottom: "14px" }}>Lobby — warte auf den Startschuss der Lehrkraft</div>
                    <button onClick={() => onStartTest(a)} style={{ width: "100%", padding: "13px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
                      In Warteraum eintreten →
                    </button>
                  </div>
                ))}
              </Section>
            )}

            {/* ACTIVE TESTS */}
            {active.length > 0 && (
              <Section title="JETZT VERFÜGBAR" icon="✅" color="#16a34a" count={active.length}>
                {active.map(a => (
                  <div key={a.id} style={{ background: "rgba(22,163,74,0.15)", borderRadius: "16px", padding: "18px 20px", marginBottom: "10px", border: "1px solid rgba(22,163,74,0.35)" }}>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", marginBottom: "14px" }}>
                      ⏱ {Math.round((a.time_limit || 0) / 60)} Min.
                      {a.timing_mode === "window" && <span style={{ marginLeft: "8px" }}>📅 {timeLabel(a)}</span>}
                    </div>
                    <button onClick={() => onStartTest(a)} style={{ width: "100%", padding: "14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>
                      Test starten →
                    </button>
                  </div>
                ))}
              </Section>
            )}

            {/* UPCOMING */}
            {upcoming.length > 0 && (
              <Section title="BALD VERFÜGBAR" icon="📅" color="#ca8a04" count={upcoming.length}>
                {upcoming.map(a => (
                  <div key={a.id} style={{ background: "rgba(202,138,4,0.12)", borderRadius: "16px", padding: "16px 20px", marginBottom: "10px", border: "1px solid rgba(202,138,4,0.3)" }}>
                    <div style={{ fontWeight: 700, fontSize: "15px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>📅 {timeLabel(a)}</div>
                  </div>
                ))}
              </Section>
            )}

            {/* EMPTY STATE */}
            {lobbyWaiting.length === 0 && active.length === 0 && upcoming.length === 0 && submissions.length === 0 && (
              <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: "16px", padding: "48px 24px", textAlign: "center", marginBottom: "24px" }}>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>📭</div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: "16px" }}>Kein aktiver Test</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginTop: "6px" }}>Deine Lehrkraft hat aktuell keinen Test für dich.</div>
              </div>
            )}

            {/* COMPLETED */}
            {submissions.length > 0 && (
              <Section title="ABSOLVIERT" icon="📋" color="#2563a8" count={submissions.length}>
                {submissions.map(s => {
                  const percent = s.total_points > 0 ? Math.round((s.score / s.total_points) * 100) : 0;
                  return (
                    <div key={s.id} style={{ background: "rgba(255,255,255,0.07)", borderRadius: "14px", padding: "14px 18px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid rgba(255,255,255,0.1)" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "15px", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.assignments?.title || "Test"}</div>
                        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                          {new Date(s.submitted_at).toLocaleDateString("de-DE")} · {s.score ?? "–"}/{s.total_points} Pkt. · {percent}%
                        </div>
                      </div>
                      <div style={{ textAlign: "center", flexShrink: 0, marginLeft: "14px" }}>
                        {s.grade ? (
                          <div style={{ fontSize: "30px", fontWeight: 900, color: GRADE_COLOR[s.grade] || "#fff", lineHeight: 1 }}>{s.grade}</div>
                        ) : (
                          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>wird<br/>bewertet</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
