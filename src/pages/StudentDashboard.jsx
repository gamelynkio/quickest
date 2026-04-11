import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

function SubmissionDetailModal({ submission, onClose }) {
  const corrections = submission.ai_corrections || {};

  // Originalreihenfolge aus question_data rekonstruieren
  const [orderedCorrections, setOrderedCorrections] = useState([]);

  useEffect(() => {
    const flat = [];
    const qs = submission.question_data || [];
    for (const q of qs) {
      if (q.type === "section") {
        for (const task of (q.tasks || [])) {
          for (const tq of (task.questions || [])) flat.push(tq);
        }
      } else {
        flat.push(q);
      }
    }
    const ordered = flat
      .map(q => ({ q, correction: corrections[String(q.id)] }))
      .filter(({ correction }) => correction !== undefined);
    // Fallback: alle corrections in DB-Reihenfolge
    if (ordered.length === 0) {
      setOrderedCorrections(Object.entries(corrections).map(([qId, correction]) => ({ qId, correction })));
    } else {
      setOrderedCorrections(ordered.map(({ q, correction }) => ({ qId: String(q.id), correction, question: q })));
    }
  }, [submission]);

  const totalPoints = submission.total_points || 0;
  const score = submission.score ?? 0;
  const percent = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "20px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "560px", marginTop: "20px", marginBottom: "20px" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #1e3a5f, #2563a8)", borderRadius: "20px 20px 0 0", padding: "22px 24px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "18px", fontWeight: 800, marginBottom: "4px" }}>{submission.assignments?.title || "Test"}</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)" }}>
                {new Date(submission.submitted_at).toLocaleDateString("de-DE")}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}>✕</button>
          </div>

          {/* Score summary */}
          <div style={{ display: "flex", gap: "16px", marginTop: "16px", alignItems: "center" }}>
            {submission.grade && (
              <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: "12px", padding: "10px 18px", textAlign: "center" }}>
                <div style={{ fontSize: "36px", fontWeight: 900, color: GRADE_COLOR[submission.grade] || "#fff", lineHeight: 1 }}>{submission.grade}</div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", marginTop: "2px" }}>Note</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: "22px", fontWeight: 800 }}>{score} / {totalPoints} Pkt.</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", marginTop: "2px" }}>{percent}% erreicht</div>
              {/* Progress bar */}
              <div style={{ height: "6px", background: "rgba(255,255,255,0.2)", borderRadius: "4px", width: "180px", marginTop: "8px" }}>
                <div style={{ height: "6px", borderRadius: "4px", background: "#fff", width: `${percent}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Corrections */}
        <div style={{ padding: "20px 24px" }}>
          {orderedCorrections.map(({ qId, correction, question }, i) => {
            const isCorrect = correction.correct === true;
            const isWrong = correction.correct === false;
            const isAi = correction.aiReviewed;
            const pts = correction.points ?? 0;

            return (
              <div key={qId} style={{ marginBottom: "14px", background: "#f8fafc", borderRadius: "12px", padding: "14px 16px", border: `1px solid ${isCorrect ? "#bbf7d0" : isWrong ? "#fecaca" : "#e2e8f0"}` }}>
                {/* Question header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>Aufgabe {i + 1}</span>
                    {isCorrect && <span style={{ color: "#16a34a", fontSize: "14px" }}>✓</span>}
                    {isWrong && <span style={{ color: "#dc2626", fontSize: "14px" }}>✗</span>}
                    {isAi && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 5px", fontWeight: 700 }}>🤖 KI</span>}
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: isCorrect ? "#16a34a" : isWrong ? "#dc2626" : "#374151" }}>
                    {pts} / {correction.maxPoints} Pkt.
                  </span>
                </div>

                {/* Student answer */}
                <div style={{ fontSize: "13px", color: "#374151", marginBottom: "6px" }}>
                  <span style={{ color: "#94a3b8" }}>Deine Antwort: </span>
                  {correction.studentAnswer ?? "–"}
                </div>

                {/* AI/teacher comment */}
                {correction.comment && (
                  <div style={{ background: isCorrect ? "#dcfce7" : isAi ? "#eff6ff" : isWrong ? "#fef2f2" : "#fef9c3", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: isCorrect ? "#16a34a" : isAi ? "#1e40af" : isWrong ? "#dc2626" : "#92400e" }}>
                    {correction.comment}
                  </div>
                )}

                {/* Solution */}
                {correction.solution && (
                  <div style={{ background: "#f0f7ff", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: "#1e3a5f", border: "1px solid #bfdbfe" }}>
                    <strong>📝 Musterlösung:</strong> {correction.solution}
                  </div>
                )}

                {/* Partial points / rubric */}
                {(correction.partialPoints?.length > 0) && (
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "#64748b", userSelect: "none", padding: "2px 0" }}>
                      📋 Bewertungsmaßstab
                    </summary>
                    <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "3px" }}>
                      {correction.partialPoints.map((p, pi) => (
                        <div key={pi} style={{ fontSize: "12px", color: "#374151", display: "flex", gap: "6px", alignItems: "center" }}>
                          <span style={{ background: "#eff6ff", borderRadius: "4px", padding: "1px 6px", fontWeight: 700, color: "#2563a8", flexShrink: 0 }}>{p.points} Pkt.</span>
                          <span>{p.description}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}

          <button onClick={onClose} style={{ width: "100%", padding: "13px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer", marginTop: "4px" }}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudentDashboard({ currentUser, onStartTest, onLogout }) {
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [allMakeupAssignments, setAllMakeupAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sebBlockedAssignment, setSebBlockedAssignment] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);

  useEffect(() => { fetchData(); }, []);

  // Automatisch aktualisieren solange Abgaben ohne Note vorhanden
  useEffect(() => {
    const hasUngraded = submissions.some(s => !s.grade);
    if (!hasUngraded) return;
    const poll = setInterval(fetchData, 5000);
    return () => clearInterval(poll);
  }, [submissions]);

  const fetchData = async () => {
    const [{ data: asgn }, { data: subs }, { data: allMakeups }] = await Promise.all([
      supabase.from("assignments").select("*").eq("group_id", currentUser.group_id).eq("status", "aktiv"),
      supabase.from("submissions")
        .select("*, assignments(title, question_data)")
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
          <a href="https://apps.apple.com/us/app/safeexambrowser/id1155002964" target="_blank" rel="noreferrer"
            style={{ padding: "10px", background: "#000", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>🍎 App Store (iOS)</a>
          <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer"
            style={{ padding: "10px", background: "#0078d4", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "12px", fontWeight: 600 }}>🪟 Windows / macOS</a>
        </div>
        <a href="sebs://quickest.lovable.app/?role=student"
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

  const hasUngraded = submissions.some(s => !s.grade);

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

        {/* Hinweis wenn Note noch aussteht */}
        {hasUngraded && !loading && (
          <div style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "12px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "12px", height: "12px", border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
              Deine Note wird gerade berechnet — diese Seite aktualisiert sich automatisch.
            </span>
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

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
