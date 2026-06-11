import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

function SubmissionDetailModal({ submission: initialSubmission, onClose, onLobbyReset }) {
  const [submission, setSubmission] = useState(initialSubmission);

  // Automatisch aktualisieren + Lobby-Reset erkennen
  useEffect(() => {
    const poll = setInterval(async () => {
      // Submission-Daten frisch laden
      const qtStudent = JSON.parse(sessionStorage.getItem("qt_student") || "{}");
      // Frische Daten + Lobby-Reset-Check in einem Call
      const { data: ctx } = await supabase.rpc("get_student_context", {
        _username: qtStudent.username || "",
        _pin: qtStudent.pin || ""
      });
      if (ctx && !ctx.error) {
        const freshSub = (ctx.submissions || []).find(s => s.id === initialSubmission.id);
        if (freshSub) setSubmission(prev => ({ ...prev, ...freshSub }));
        const asgn = (ctx.assignments || []).find(a => a.id === initialSubmission.assignment_id);
        if (!asgn) onLobbyReset?.(); // Assignment nicht mehr aktiv → wurde zurückgesetzt
      }
    }, 4000);
    return () => clearInterval(poll);
  }, [initialSubmission.id]);
  const corrections = submission.ai_corrections || {};

  const [orderedCorrections, setOrderedCorrections] = useState([]);
  const [requestTexts, setRequestTexts] = useState({});
  const [submittedRequests, setSubmittedRequests] = useState({});
  const [submitting, setSubmitting] = useState(null);

  // orderedCorrections und submittedRequests aktuell halten wenn Polling neue Daten bringt
  useEffect(() => {
    const corrections = submission.ai_corrections || {};
    const qs = submission.question_data || [];
    const flat = (arr) => {
      const res = [];
      for (const q of arr) {
        if (q.type === "section") for (const t of (q.tasks||[])) for (const tq of (t.questions||[])) res.push(tq);
        else if (q.type === "task") for (const tq of (q.questions||[])) res.push(tq);
        else res.push(q);
      }
      return res;
    };
    const ordered = flat(qs).map(q => [String(q.id), corrections[String(q.id)] || corrections[q.id] || null]).filter(([,c]) => c);
    setOrderedCorrections(ordered);
    setSubmittedRequests(Object.fromEntries(Object.entries(submission.correction_requests || {}).map(([k,v]) => [k,v])));
  }, [submission]);

  useEffect(() => {
    const flat = [];
    const qs = submission.question_data || [];
    for (const q of qs) {
      if (q.type === "section") {
        for (const task of (q.tasks || [])) {
          for (const tq of (task.questions || [])) flat.push(tq);
        }
      } else if (q.type === "task") {
        for (const tq of (q.questions || [])) flat.push(tq);
      } else {
        flat.push(q);
      }
    }
    const ordered = flat
      .map(q => ({ q, correction: corrections[String(q.id)] }))
      .filter(({ correction }) => correction !== undefined);
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
              <div style={{ height: "6px", background: "rgba(255,255,255,0.2)", borderRadius: "4px", width: "180px", marginTop: "8px" }}>
                <div style={{ height: "6px", borderRadius: "4px", background: "#fff", width: `${percent}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "20px 24px" }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 16px", marginBottom: "18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "13px" }}>
            <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>SCHÜLER/IN</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{submission.username}</span></div>
            <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>DATUM</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{new Date(submission.submitted_at).toLocaleDateString("de-DE")}</span></div>
            <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>LEHRKRAFT</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{submission.teacherName || "–"}</span></div>
          </div>
          {orderedCorrections.map(({ qId, correction, question }, i) => {
            const manualOverride = submission.manual_overrides?.[qId];
            const pts = manualOverride !== undefined ? Number(manualOverride) : (correction.points ?? 0);
            const isManual = manualOverride !== undefined;
            const isCorrect = pts >= (correction.maxPoints ?? 0) && pts > 0;
            const isWrong = pts === 0 && correction.maxPoints > 0;
            const isAi = correction.aiReviewed && !isManual;

            return (
              <div key={qId} style={{ marginBottom: "14px", background: "#f8fafc", borderRadius: "12px", padding: "14px 16px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>Aufgabe {i + 1}</span>
                    {isCorrect && <span style={{ color: "#16a34a", fontSize: "14px" }}>✓</span>}
                    {isWrong && <span style={{ color: "#dc2626", fontSize: "14px" }}>✗</span>}
                    {isManual && <span style={{ fontSize: "10px", background: "#fef9c3", color: "#92400e", borderRadius: "4px", padding: "1px 5px", fontWeight: 700 }}>✏️ Angepasst</span>}
                    {isAi && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 5px", fontWeight: 700 }}>🤖 KI</span>}
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: isCorrect ? "#16a34a" : isWrong ? "#dc2626" : "#374151" }}>
                    {pts} / {correction.maxPoints} Pkt.
                  </span>
                </div>
                {question?.text && (
                  <div style={{ fontSize: "13px", color: "#0f172a", fontWeight: 600, marginBottom: "6px" }}>
                    {question.text}
                  </div>
                )}
                <div style={{ fontSize: "13px", color: "#374151", marginBottom: "6px" }}>
                  <span style={{ color: "#94a3b8" }}>Deine Antwort: </span>
                  {(() => {
                    const ans = submission.answers?.[qId] ?? submission.answers?.[Number(qId)];
                    if (ans === undefined || ans === null || ans === "") return "–";
                    if (Array.isArray(ans)) return ans.join(", ");
                    return String(ans);
                  })()}
                </div>
                {correction.solution && (
                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Musterlösung</div>
                    <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 10px", fontSize: "12px", color: "#374151", border: "1px solid #e2e8f0" }}>
                      {correction.solution}
                    </div>
                  </div>
                )}
                {(correction.comment || correction.usedCriteria) && (() => {
                  const commentText = correction.comment?.replace("🤖 ", "").replace("⏳ Wartet auf Bewertung", "").trim();
                  if (!commentText && !correction.usedCriteria) return null;
                  return (
                    <div style={{ marginBottom: "8px" }}>
                      <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Kommentar der KI</div>
                      <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 10px", fontSize: "12px", color: "#374151", border: "1px solid #e2e8f0" }}>
                        <span style={{ marginRight: "4px" }}>🤖</span>
                        {commentText}
                        {commentText && correction.usedCriteria && <span style={{ color: "#94a3b8", margin: "0 4px" }}>·</span>}
                        {correction.usedCriteria && <span style={{ color: "#64748b" }}>{correction.usedCriteria}</span>}
                      </div>
                    </div>
                  );
                })()}
                {correction.teacherComment && (
                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Kommentar der Lehrkraft</div>
                    <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 10px", fontSize: "12px", color: "#374151", border: "1px solid #e2e8f0" }}>
                      ✏️ {correction.teacherComment}
                    </div>
                  </div>
                )}

                {/* Nachkorrektur anfragen */}
                {submittedRequests[qId] ? (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", color: "#16a34a", marginBottom: "8px" }}>
                    ✓ Nachkorrektur beantragt: „{submittedRequests[qId].text}"
                  </div>
                ) : (
                  <div style={{ marginBottom: "8px" }}>
                    {requestTexts[qId] !== undefined ? (
                      <div>
                        <textarea
                          value={requestTexts[qId]}
                          onChange={e => setRequestTexts(prev => ({ ...prev, [qId]: e.target.value }))}
                          placeholder="Begründe warum du eine Nachkorrektur anfragst..."
                          rows={2}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "6px" }}
                        />
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => setRequestTexts(prev => { const n = { ...prev }; delete n[qId]; return n; })}
                            style={{ flex: 1, padding: "6px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "7px", fontSize: "12px", cursor: "pointer" }}>
                            Abbrechen
                          </button>
                          <button onClick={async () => {
                            if (!requestTexts[qId]?.trim()) return;
                            setSubmitting(qId);
                            const updated = { ...(submission.correction_requests || {}), [qId]: { text: requestTexts[qId].trim(), ts: new Date().toISOString(), status: "open" } };
                            const qtStudent = JSON.parse(sessionStorage.getItem("qt_student") || "{}");
                            const { data: rpcOk, error } = await supabase.rpc("request_correction", {
                              _submission_id: submission.id,
                              _username: qtStudent.username || "",
                              _pin: qtStudent.pin || "",
                              _question_id: qId,
                              _request_text: requestTexts[qId].trim()
                            });
                            if (error || !rpcOk) {
                              alert("Fehler beim Speichern: " + (error?.message || "Unbekannter Fehler"));
                              setSubmitting(null);
                              return;
                            }
                            setSubmittedRequests(prev => ({ ...prev, [qId]: { text: requestTexts[qId].trim() } }));
                            setRequestTexts(prev => { const n = { ...prev }; delete n[qId]; return n; });
                            setSubmitting(null);
                            }} disabled={!requestTexts[qId]?.trim() || submitting === qId}
                            style={{ flex: 2, padding: "6px", background: requestTexts[qId]?.trim() ? "#f97316" : "#e2e8f0", color: requestTexts[qId]?.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                            {submitting === qId ? "⏳" : "✓ Anfrage absenden"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setRequestTexts(prev => ({ ...prev, [qId]: "" }))}
                        style={{ width: "100%", padding: "6px 10px", background: "none", border: "1px dashed #e2e8f0", borderRadius: "7px", fontSize: "12px", color: "#94a3b8", cursor: "pointer", textAlign: "left" }}>
                        🔁 Nachkorrektur anfragen
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={onClose} style={{ width: "100%", padding: "13px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer", marginTop: "4px" }}>
            Schließen
          </button>
          <p style={{ fontSize: "11px", color: "#94a3b8", textAlign: "center", marginTop: "8px" }}>
            Fehler in der Korrektur? Nutze die Schaltfläche „Nachkorrektur anfragen" bei der jeweiligen Aufgabe.
          </p>
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

  // Permanentes Polling alle 4 Sek. — neue Tests, Lobbys, Notenänderungen
  useEffect(() => {
    const poll = setInterval(fetchData, 4000);
    return () => clearInterval(poll);
  }, []);

  const fetchData = async () => {
    const qtStudent = JSON.parse(sessionStorage.getItem("qt_student") || "{}");
    if (!qtStudent.username || !qtStudent.pin) return;
    const { data, error } = await supabase.rpc("get_student_context", {
      _username: qtStudent.username,
      _pin: qtStudent.pin
    });
    if (error || !data || data.error) return;
    setAssignments(data.assignments || []);
    setSubmissions((data.submissions || []).map(s => ({
      ...s,
      assignments: { title: (data.assignments || []).find(a => a.id === s.assignment_id)?.title || "" }
    })));
    setAllMakeupAssignments(data.all_group_assignments || []);
    setLoading(false);
  };

  const submittedIds = new Set(submissions.map(s => String(s.assignment_id)));

  const coveredByMakeup = new Set(
    allMakeupAssignments
      .filter(a => submittedIds.has(String(a.id)))
      .map(a => String(a.parent_assignment_id))
  );

  const visibleAssignments = assignments.filter(a => a.status === "aktiv").filter(a => {
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

  const handleOpenSubmission = async (s) => {
    const [{ data: freshSubmission }, { data: assignmentData }] = await Promise.all([
      (async () => {
        const qtStudent = JSON.parse(sessionStorage.getItem("qt_student") || "{}");
        const { data: ctx } = await supabase.rpc("get_student_context", { _username: qtStudent.username || "", _pin: qtStudent.pin || "" });
        const sub = (ctx?.submissions || []).find(sub => sub.id === s.id);
        return { data: sub || s };
      })(),
      supabase.from("assignments").select("question_data, teacher_id").eq("id", s.assignment_id).single(),
    ]);
    let teacherName = "–";
    if (assignmentData?.teacher_id) {
      const { data: profile } = await supabase.from("profiles").select("name").eq("id", assignmentData.teacher_id).single();
      if (profile?.name) teacherName = profile.name;
    }
    setSelectedSubmission({
      ...(freshSubmission || s),
      assignments: s.assignments,
      question_data: assignmentData?.question_data || [],
      teacherName,
    });
  };

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
          Dieser Test muss mit dem <strong>Safe Exam Browser</strong> geöffnet werden.
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

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1e3a5f 0%, #2563a8 50%, #1e3a5f 100%)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px 16px 40px" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      <div style={{ maxWidth: "500px", margin: "0 auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", paddingTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "26px" }}>⚡</span>
            <div>
              <div style={{ fontSize: "19px", fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>QuickTest</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>{currentUser.username}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Live-Indikator */}
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Live</span>
            </div>
            <button onClick={onLogout} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.8)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}>
              Abmelden
            </button>
          </div>
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
                    <div key={s.id} onClick={() => s.released && handleOpenSubmission(s)}
                      style={{ background: "rgba(255,255,255,0.07)", borderRadius: "14px", padding: "14px 18px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid rgba(255,255,255,0.1)", cursor: s.released ? "pointer" : "default", transition: "background 0.15s" }}
                      onMouseOver={e => s.released && (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                      onMouseOut={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "15px", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.assignments?.title || "Test"}</div>
                        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                          {new Date(s.submitted_at).toLocaleDateString("de-DE")}{s.released ? ` · ${s.score ?? "–"}/${s.total_points} Pkt. · ${percent}%` : ""}
                          {s.released ? <span style={{ marginLeft: "6px", color: "rgba(255,255,255,0.4)" }}>· Tippen für Details</span> : <span style={{ marginLeft: "6px", color: "rgba(255,255,255,0.3)", fontSize: "11px" }}>· Korrektur ausstehend</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "center", flexShrink: 0, marginLeft: "14px" }}>
                        {s.not_participated ? (
                          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textAlign: "center", fontStyle: "italic" }}>nicht<br/>teilgenommen</div>
                        ) : s.released && s.grade ? (
                          <div style={{ fontSize: "30px", fontWeight: 900, color: GRADE_COLOR[s.grade] || "#fff", lineHeight: 1 }}>{s.grade}</div>
                        ) : s.released ? (
                          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>wird<br/>bewertet</div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                            <div style={{ width: "8px", height: "8px", border: "2px solid rgba(255,255,255,0.2)", borderTop: "2px solid rgba(255,255,255,0.6)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>ausstehend</span>
                          </div>
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
      {selectedSubmission && <SubmissionDetailModal submission={selectedSubmission} onClose={() => setSelectedSubmission(null)} onLobbyReset={() => { setSelectedSubmission(null); fetchData(); }} />}
    </div>
  );
}
