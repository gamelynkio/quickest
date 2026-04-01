import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

export default function StudentDashboard({ currentUser, onStartTest, onLogout }) {
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [allMakeupAssignments, setAllMakeupAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sebBlockedAssignment, setSebBlockedAssignment] = useState(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: asgn }, { data: subs }, { data: allMakeups }] = await Promise.all([
      supabase.from("assignments").select("*").eq("group_id", currentUser.group_id).eq("status", "aktiv"),
      supabase.from("submissions")
        .select("*, assignments(title)")
        .eq("username", currentUser.username)
        .order("submitted_at", { ascending: false }),
      supabase.from("assignments").select("id, parent_assignment_id")
        .eq("group_id", currentUser.group_id)
        .not("parent_assignment_id", "is", null),
    ]);

    setAssignments(asgn || []);
    setSubmissions(subs || []);
    setAllMakeupAssignments(allMakeups || []);
    setLoading(false);
  };

  const submittedIds = new Set(submissions.map(s => String(s.assignment_id)));

  const coveredByMakeup = new Set(
    allMakeupAssignments
      .filter(a => submittedIds.has(String(a.id)))
      .map(a => String(a.parent_assignment_id))
  );

  const visibleAssignments = assignments.filter(a => {
    if (submittedIds.has(String(a.id))) return false;
    if (coveredByMakeup.has(String(a.id))) return false;
    if (a.parent_assignment_id) {
      if (a.makeup_usernames?.length && !a.makeup_usernames.includes(currentUser.username)) return false;
      if (submittedIds.has(String(a.parent_assignment_id))) return false;
    }
    return true;
  });

  const lobbyWaiting = visibleAssignments.filter(a =>
    a.timing_mode === "lobby" && !a.lobby_started_at
  );

  const active = visibleAssignments.filter(a => {
    if (a.timing_mode === "lobby") return !!a.lobby_started_at;
    if (a.timing_mode === "window") {
      if (!a.window_date || !a.window_start || !a.window_end) return false;
      const now = new Date();
      const start = new Date(`${a.window_date}T${a.window_start}`);
      const end = new Date(`${a.window_date}T${a.window_end}`);
      return now >= start && now <= end;
    }
    return true;
  });

  const upcoming = visibleAssignments.filter(a => {
    if (a.timing_mode === "lobby" && !a.lobby_started_at) return false;
    if (a.timing_mode === "window" && a.window_date) {
      const start = new Date(`${a.window_date}T${a.window_start}`);
      return new Date() < start;
    }
    return false;
  });

  const handleStartTest = (assignment) => {
    const isSEB = navigator.userAgent.includes("SEB") || navigator.userAgent.includes("SafeExamBrowser");
    if (assignment.require_seb && !isSEB) {
      setSebBlockedAssignment(assignment);
      return;
    }
    onStartTest(assignment);
  };

  const SEB_MODAL = () => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "24px", padding: "32px", maxWidth: "480px", width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: "52px", marginBottom: "12px" }}>🔒</div>
        <h3 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: "0 0 10px" }}>Safe Exam Browser erforderlich</h3>
        <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "20px", lineHeight: 1.6 }}>
          Dieser Test muss mit dem <strong>Safe Exam Browser</strong> geöffnet werden. Er verhindert Autokorrektur, Tab-Wechsel und andere Apps während der Prüfung.
        </p>
        <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "16px", marginBottom: "20px", textAlign: "left" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "10px" }}>So geht's:</div>
          <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#64748b", lineHeight: 2 }}>
            <li>Installiere die <strong>Safe Exam Browser</strong> App (einmalig)</li>
            <li>Klicke auf „Safe Exam Browser starten" — SEB öffnet sich automatisch</li>
            <li>Logge dich ein und starte den Test</li>
          </ol>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
          <a href="https://apps.apple.com/app/safe-exam-browser/id1587573560" target="_blank" rel="noreferrer"
            style={{ padding: "10px", background: "#000", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>🍎 App Store (iOS)</a>
          <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer"
            style={{ padding: "10px", background: "#0078d4", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>🪟 Windows / macOS</a>
        </div>
        <a href="/quicktest.seb"
          style={{ display: "block", padding: "14px", background: "#7c3aed", color: "#fff", borderRadius: "12px", fontWeight: 700, fontSize: "14px", textDecoration: "none", marginBottom: "10px" }}>
          🔒 Safe Exam Browser starten
        </a>
        <button onClick={() => setSebBlockedAssignment(null)}
          style={{ width: "100%", padding: "12px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
          Zurück zum Dashboard
        </button>
      </div>
    </div>
  );

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
            {lobbyWaiting.length > 0 && (
              <Section title="WARTERAUM" icon="🎮" color="#6d28d9" count={lobbyWaiting.length}>
                {lobbyWaiting.map(a => (
                  <div key={a.id} style={{ background: "rgba(109,40,217,0.2)", borderRadius: "16px", padding: "18px 20px", marginBottom: "10px", border: "1px solid rgba(109,40,217,0.4)" }}>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", marginBottom: "14px" }}>Lobby — warte auf den Startschuss der Lehrkraft</div>
                    <button onClick={() => handleStartTest(a)} style={{ width: "100%", padding: "13px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
                      In Warteraum eintreten →
                    </button>
                  </div>
                ))}
              </Section>
            )}

            {active.length > 0 && (
              <Section title="JETZT VERFÜGBAR" icon="✅" color="#16a34a" count={active.length}>
                {active.map(a => (
                  <div key={a.id} style={{ background: "rgba(22,163,74,0.15)", borderRadius: "16px", padding: "18px 20px", marginBottom: "10px", border: "1px solid rgba(22,163,74,0.35)" }}>
                    <div style={{ fontWeight: 700, fontSize: "16px", color: "#fff", marginBottom: "4px" }}>{a.title}</div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", marginBottom: "14px" }}>
                      ⏱ {Math.round((a.time_limit || 0) / 60)} Min.
                      {a.timing_mode === "window" && <span style={{ marginLeft: "8px" }}>📅 {timeLabel(a)}</span>}
                    </div>
                    <button onClick={() => handleStartTest(a)} style={{ width: "100%", padding: "14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>
                      Test starten →
                    </button>
                  </div>
                ))}
              </Section>
            )}

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

            {lobbyWaiting.length === 0 && active.length === 0 && upcoming.length === 0 && submissions.length === 0 && (
              <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: "16px", padding: "48px 24px", textAlign: "center", marginBottom: "24px" }}>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>📭</div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: "16px" }}>Kein aktiver Test</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px", marginTop: "6px" }}>Deine Lehrkraft hat aktuell keinen Test für dich.</div>
              </div>
            )}

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
      {sebBlockedAssignment && <SEB_MODAL />}
    </div>
  );
}
