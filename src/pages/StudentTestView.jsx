import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const COLORS = ["#fff8e7", "#f0fdf4", "#f0f9ff", "#fdf2f8", "#f5f3ff", "#fff1f2"];

const flattenQuestions = (qs) => {
  const result = [];
  for (const q of qs) {
    if (q.type === "section") {
      for (const task of (q.tasks || [])) {
        for (const tq of (task.questions || [])) {
          result.push({ ...tq, _taskId: task.id, _sectionId: q.id });
        }
      }
    } else {
      result.push(q);
    }
  }
  return result;
};

const autoCorrect = (questions, answers) => {
  let score = 0;
  const corrections = {};
  for (const q of questions) {
    if (q.type === "section") continue;
    const studentAnswer = answers[q.id];
    const maxPoints = Number(q.points || 0);
    if (q.type === "multiple_choice") {
      const correctAnswers = q.correctAnswers?.length ? q.correctAnswers : (q.correctAnswer != null ? [q.correctAnswer] : []);
      const studentAnswers = Array.isArray(studentAnswer) ? studentAnswer : (studentAnswer != null ? [studentAnswer] : []);
      const correct = correctAnswers.length > 0 && correctAnswers.length === studentAnswers.length && correctAnswers.every(a => studentAnswers.map(Number).includes(Number(a)));
      const correctLabels = correctAnswers.map(i => q.options?.[i] ?? String(i)).join(", ");
      const studentLabels = studentAnswers.map(i => q.options?.[i] ?? String(i)).join(", ");
      corrections[q.id] = { points: correct ? maxPoints : 0, maxPoints, correct, studentAnswer: studentLabels || "–", comment: correct ? "Richtig" : `Falsch. Richtige Antwort: ${correctLabels}`, solution: q.solution || null, partialPoints: q.partialPoints || [] };
      score += correct ? maxPoints : 0;
    } else if (q.type === "true_false") {
      const correct = studentAnswer !== undefined && Number(studentAnswer) === Number(q.correctAnswer);
      corrections[q.id] = { points: correct ? maxPoints : 0, maxPoints, correct, studentAnswer: studentAnswer === 0 || studentAnswer === "0" ? "Wahr" : "Falsch", comment: correct ? "Richtig" : `Falsch. Richtige Antwort: ${q.correctAnswer === 0 ? "Wahr" : "Falsch"}`, solution: q.solution || null, partialPoints: q.partialPoints || [] };
      score += correct ? maxPoints : 0;
    } else if (q.type === "flashcard") {
      const accepted = [q.cardBack, ...(q.cardBackAlternatives || [])].map(s => String(s || "").toLowerCase().trim()).filter(Boolean);
      const given = String(studentAnswer || "").toLowerCase().trim();
      const correct = accepted.length > 0 && accepted.includes(given);
      corrections[q.id] = { points: correct ? maxPoints : 0, maxPoints, correct, studentAnswer: String(studentAnswer || ""), comment: correct ? "Richtig" : `Falsch. Richtige Antwort: ${q.cardBack || "–"}`, solution: q.solution || null, partialPoints: q.partialPoints || [] };
      score += correct ? maxPoints : 0;
    } else if (q.type === "fill_blank") {
      const blanks = q.blanks || [];
      if (blanks.length === 0) {
        corrections[q.id] = { points: 0, maxPoints, correct: false, studentAnswer: String(studentAnswer || ""), comment: "Keine Lösung hinterlegt", solution: null, partialPoints: [] };
      } else {
        const studentAnswers = Array.isArray(studentAnswer) ? studentAnswer : [String(studentAnswer || "")];
        let correctCount = 0;
        const blankResults = blanks.map((blank, i) => {
          const given = String(studentAnswers[i] || "").toLowerCase().trim();
          const accepted = [blank.solution, ...(blank.alternatives || [])].map(s => s.toLowerCase().trim());
          const correct = accepted.includes(given);
          if (correct) correctCount++;
          return { given: studentAnswers[i] || "", correct, solution: blank.solution };
        });
        const ptsPerBlank = blanks.length > 0 ? maxPoints / blanks.length : 0;
        const earnedPoints = Math.round(correctCount * ptsPerBlank * 2) / 2;
        corrections[q.id] = { points: earnedPoints, maxPoints, correct: correctCount === blanks.length, studentAnswer: studentAnswers.join(", "), comment: `${correctCount} von ${blanks.length} Lücken richtig`, blankResults, solution: blanks.map((b, i) => `Lücke ${i+1}: ${b.solution}`).join(" | "), partialPoints: q.partialPoints || [] };
        score += earnedPoints;
      }
    } else if (q.type === "open" || q.type === "qa") {
      corrections[q.id] = { points: null, maxPoints, correct: null, studentAnswer: String(studentAnswer || ""), comment: "⏳ Wartet auf Bewertung", solution: q.solution || null, partialPoints: q.partialPoints || [], needsReview: true };
    } else if (q.type === "assignment") {
      const pairs = q.pairs || [];
      const studentPairs = studentAnswer || {};
      let correctPairs = 0;
      for (let i = 0; i < pairs.length; i++) { if (studentPairs[i] === pairs[i].right) correctPairs++; }
      const pairPoints = pairs.length > 0 ? Math.round((correctPairs / pairs.length) * maxPoints * 2) / 2 : 0;
      corrections[q.id] = { points: pairPoints, maxPoints, correct: correctPairs === pairs.length, studentAnswer: Object.values(studentPairs).join(", "), comment: `${correctPairs} von ${pairs.length} Paaren richtig`, solution: q.solution || null, partialPoints: q.partialPoints || [] };
      score += pairPoints;
    }
  }
  return { score, corrections };
};

const calcGrade = (score, totalPoints, gradingScale) => {
  if (!totalPoints || !gradingScale?.length) return null;
  const percent = (score / totalPoints) * 100;
  const sorted = [...gradingScale].sort((a, b) => b.minPercent - a.minPercent);
  for (const g of sorted) { if (percent >= Number(g.minPercent)) return g.grade; }
  return "6";
};

const safeStorage = {
  getItem: (key) => { try { return sessionStorage.getItem(key); } catch (_) { try { return localStorage.getItem(key); } catch (__) { return null; } } },
  setItem: (key, value) => { try { sessionStorage.setItem(key, value); } catch (_) { try { localStorage.setItem(key, value); } catch (__) {} } },
  removeItem: (key) => { try { sessionStorage.removeItem(key); } catch (_) { try { localStorage.removeItem(key); } catch (__) {} } },
};

export default function StudentTestView({ currentUser, assignment: assignmentProp, onFinish }) {
  const [assignment, setAssignment] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lobbyWaiting, setLobbyWaiting] = useState(false);
  const [lobbyPlayerCount, setLobbyPlayerCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [sebRequired, setSebRequired] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showCheatWarning, setShowCheatWarning] = useState(false);
  const cheatLogRef = useRef([]);
  const submissionIdRef = useRef(null);
  const handleSubmitRef = useRef(null);

  useEffect(() => { fetchAssignment(assignmentProp || null); }, []);

  const fetchAssignment = async (preloaded = null) => {
    setLoading(true);
    let data = null;
    if (preloaded) {
      const { data: fresh } = await supabase.from("assignments").select("*").eq("id", preloaded.id).single();
      data = fresh || preloaded;
    } else {
      const { data: aktiv } = await supabase.from("assignments").select("*").eq("group_id", currentUser.group_id).eq("status", "aktiv").order("created_at", { ascending: false }).limit(1).single();
      if (aktiv) { data = aktiv; }
      else {
        const { data: beendet } = await supabase.from("assignments").select("*").eq("group_id", currentUser.group_id).eq("status", "beendet").order("created_at", { ascending: false }).limit(1).single();
        data = beendet || null;
      }
    }
    if (data) {
      if (data.status === "beendet") {
        const { data: existingSub } = await supabase.from("submissions").select("id").eq("assignment_id", data.id).eq("username", currentUser.username).maybeSingle();
        if (!existingSub) { setAssignment(data); setIsEnded(true); }
        setLoading(false);
        return;
      }
      const isSEB = navigator.userAgent.includes("SEB") || navigator.userAgent.includes("SafeExamBrowser");
      if (data.require_seb && !isSEB) { setAssignment(data); setSebRequired(true); setLoading(false); return; }
      const { data: existingSubmission } = await supabase.from("submissions").select("id").eq("assignment_id", data.id).eq("username", currentUser.username).maybeSingle();
      if (existingSubmission) { setLoading(false); return; }
      if (data.parent_assignment_id && data.makeup_usernames?.length) {
        if (!data.makeup_usernames.includes(currentUser.username)) { setLoading(false); return; }
      }
      if (data.timing_mode === "window" && data.window_date && data.window_end) {
        const windowEnd = new Date(`${data.window_date}T${data.window_end}`);
        if (new Date() > windowEnd) { await supabase.from("assignments").update({ status: "beendet" }).eq("id", data.id); setLoading(false); return; }
        data.time_limit = Math.max(0, Math.floor((windowEnd - new Date()) / 1000));
      }
      setAssignment(data);
      const storageKey = `qt_start_${data.id}_${currentUser.id}`;
      const timeLimit = data.time_limit || 1200;
      if (data.timing_mode === "lobby" && data.lobby_started_at) {
        const elapsed = Math.floor((Date.now() - new Date(data.lobby_started_at).getTime()) / 1000);
        setTimeLeft(Math.max(0, timeLimit - elapsed));
      } else if (data.timing_mode === "window") {
        setTimeLeft(timeLimit);
      } else {
        const storedStart = safeStorage.getItem(storageKey);
        if (storedStart) { setTimeLeft(Math.max(0, timeLimit - Math.floor((Date.now() - Number(storedStart)) / 1000))); }
        else { safeStorage.setItem(storageKey, String(Date.now())); setTimeLeft(timeLimit); }
      }
      const qs = data.question_data || [];
      if (data.anti_cheat) {
        const nonSections = qs.filter(q => q.type !== "section");
        const shuffled = [...nonSections].sort(() => Math.random() - 0.5);
        let qi = 0;
        setQuestions(qs.map(q => q.type === "section" ? q : shuffled[qi++]));
      } else { setQuestions(qs); }
      if (data.timing_mode === "lobby" && !data.lobby_started_at) {
        setLobbyWaiting(true);
        const now = new Date().toISOString();
        const { data: updated } = await supabase.from("lobby_presence").update({ last_seen: now }).eq("assignment_id", data.id).eq("username", currentUser.username).select();
        if (!updated || updated.length === 0) { await supabase.from("lobby_presence").insert({ assignment_id: data.id, username: currentUser.username, last_seen: now }); }
        const { data: presenceData } = await supabase.from("lobby_presence").select("username").eq("assignment_id", data.id).gte("last_seen", new Date(Date.now() - 15000).toISOString());
        setLobbyPlayerCount(presenceData?.length || 0);
      }
    }
    setLoading(false);
  };

  // Heartbeat
  useEffect(() => {
    if (!assignment || submitted) return;
    const assignmentId = assignment.id;
    const heartbeat = setInterval(async () => {
      await supabase.from("lobby_presence").update({ last_seen: new Date().toISOString() }).eq("assignment_id", assignmentId).eq("username", currentUser.username);
      const { data: asgn } = await supabase.from("assignments").select("paused_at, status").eq("id", assignmentId).single();
      if (asgn) { setIsPaused(!!asgn.paused_at); if (asgn.status === "beendet" && !submitted) { setIsEnded(true); handleSubmitRef.current?.(); } }
    }, 3000);
    const cleanup = async () => { await supabase.from("lobby_presence").delete().eq("assignment_id", assignmentId).eq("username", currentUser.username); };
    window.addEventListener("beforeunload", cleanup);
    return () => { clearInterval(heartbeat); window.removeEventListener("beforeunload", cleanup); };
  }, [assignment?.id, submitted]);

  // === KERN-FIX: Rekursiver Poll für paused_at + status ===
  // Verwendet rekursives setTimeout statt setInterval um Closure-Probleme zu vermeiden
  useEffect(() => {
    if (!assignment?.id) return;
    const id = assignment.id;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const { data } = await supabase
          .from("assignments")
          .select("paused_at, status")
          .eq("id", id)
          .single();
        if (!cancelled && data) {
          setIsPaused(!!data.paused_at);
          if (data.status === "beendet") {
            setIsEnded(true);
            if (!submitted) handleSubmitRef.current?.();
            return;
          }
        }
      } catch (e) { /* ignorieren */ }
      if (!cancelled) setTimeout(poll, 2000);
    };
    setTimeout(poll, 1000); // Erster Poll nach 1s
    return () => { cancelled = true; };
  }, [assignment?.id]);

  // Lobby-Poll (nur während Lobby-Warteraum aktiv)
  useEffect(() => {
    if (!lobbyWaiting || !assignment?.id) return;
    const id = assignment.id;
    const timeLimit = assignment.time_limit || 1200;
    const interval = setInterval(async () => {
      const { data } = await supabase.from("assignments").select("lobby_started_at, status").eq("id", id).single();
      if (!data) return;
      if (data.status === "beendet") { setIsEnded(true); return; }
      if (data.lobby_started_at) {
        setLobbyWaiting(false);
        setAssignment(prev => ({ ...prev, lobby_started_at: data.lobby_started_at }));
        const elapsed = Math.floor((Date.now() - new Date(data.lobby_started_at).getTime()) / 1000);
        setTimeLeft(Math.max(0, timeLimit - elapsed));
      }
      const { data: presenceData } = await supabase.from("lobby_presence").select("username").eq("assignment_id", id);
      setLobbyPlayerCount(presenceData?.length || 0);
    }, 2000);
    return () => clearInterval(interval);
  }, [lobbyWaiting, assignment?.id]);

  // Timer (pausiert wenn isPaused)
  useEffect(() => {
    if (submitted || loading || lobbyWaiting || !assignment || isPaused) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null) return null;
        if (prev <= 1) { clearInterval(timer); handleSubmit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [submitted, loading, lobbyWaiting, assignment, isPaused]);

  // Anti-cheat
  useEffect(() => {
    if (submitted || loading || lobbyWaiting || !assignment) return;
    const logSwitch = async () => {
      const entry = { time: new Date().toISOString(), event: "tab_switch" };
      cheatLogRef.current = [...cheatLogRef.current, entry];
      setTabSwitchCount(cheatLogRef.current.length);
      setShowCheatWarning(true);
      if (submissionIdRef.current) { await supabase.from("submissions").update({ cheat_log: cheatLogRef.current }).eq("id", submissionIdRef.current); }
    };
    const handleVisibility = () => { if (document.hidden) logSwitch(); };
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && ["c","v","a","t","n","w","r","f","p","u"].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); }
      if (["F5","F12"].includes(e.key)) e.preventDefault();
    };
    const handleContextMenu = (e) => e.preventDefault();
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [submitted, loading, lobbyWaiting, assignment]);

  const formatTime = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, "0")}:${String((s || 0) % 60).padStart(2, "0")}`;
  const timePercent = assignment ? (timeLeft / assignment.time_limit) * 100 : 100;
  const timeColor = timeLeft < 120 ? "#ef4444" : timeLeft < 300 ? "#f97316" : "#16a34a";

  const handleSubmit = async () => {
    if (submitting || !assignment) return;
    setSubmitting(true);
    handleSubmitRef.current = null; // verhindert Doppelaufruf
    const allQuestions = assignment.question_data || [];
    const realQuestions = flattenQuestions(allQuestions).filter(q => q.type !== "section");
    const totalPoints = realQuestions.reduce((sum, q) => sum + Number(q.points || 0), 0);
    const { score: initialScore, corrections } = autoCorrect(realQuestions, answers);
    const hasOpenQuestions = Object.values(corrections).some(c => c.needsReview);
    const grade = hasOpenQuestions ? null : calcGrade(initialScore, totalPoints, assignment.grading_scale);
    const { data: newSubmission } = await supabase.from("submissions").insert({
      assignment_id: assignment.id, student_id: currentUser.id, username: currentUser.username,
      answers, score: initialScore, total_points: totalPoints, grade,
      ai_corrections: corrections, reviewed: !hasOpenQuestions, cheat_log: cheatLogRef.current,
    }).select("id").single();
    if (newSubmission) submissionIdRef.current = newSubmission.id;
    safeStorage.removeItem(`qt_start_${assignment.id}_${currentUser.id}`);
    await supabase.from("lobby_presence").delete().eq("assignment_id", assignment.id).eq("username", currentUser.username);
    setSubmitted(true);
    setShowConfirm(false);
    setSubmitting(false);
  };
  // Ref immer aktuell halten
  handleSubmitRef.current = handleSubmit;

  const S = {
    page: { minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif" },
    center: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" },
    card: { textAlign: "center", background: "#fff", borderRadius: "24px", padding: "48px 40px", maxWidth: "440px", width: "100%" },
  };

  if (loading) return <div style={S.center}><div style={{ textAlign: "center", color: "#fff" }}><div style={{ fontSize: "56px", marginBottom: "16px" }}>⚡</div><div style={{ fontSize: "18px", fontWeight: 600 }}>Test wird geladen...</div></div></div>;

  if (lobbyWaiting) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1e3a5f, #4c1d95)", fontFamily: "'Segoe UI', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      {isPaused && !isEnded && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 }}>
          <div style={{ textAlign: "center", color: "#fff" }}><div style={{ fontSize: "64px" }}>⏸</div><div style={{ fontSize: "24px", fontWeight: 800, marginTop: "16px" }}>Test pausiert</div></div>
        </div>
      )}
      {isEnded && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.95)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600 }}>
          <div style={{ textAlign: "center", color: "#fff" }}>
            <div style={{ fontSize: "64px" }}>🏁</div>
            <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "16px" }}>Test beendet</div>
            <button onClick={() => onFinish()} style={{ marginTop: "24px", padding: "12px 28px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>Zum Dashboard →</button>
          </div>
        </div>
      )}
      <div style={{ textAlign: "center", maxWidth: "420px", width: "100%" }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>🎮</div>
        <h1 style={{ fontSize: "28px", fontWeight: 900, color: "#fff", margin: "0 0 8px" }}>Bereit!</h1>
        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "16px", marginBottom: "32px" }}>Warte auf den Start durch deine Lehrkraft...</p>
        <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "20px", padding: "24px", marginBottom: "24px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: "12px", letterSpacing: "1px" }}>DEIN NAME</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#fff" }}>{currentUser.username}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "20px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", marginBottom: "8px" }}>TEST</div>
          <div style={{ fontSize: "17px", fontWeight: 700, color: "#fff" }}>{assignment?.title}</div>
        </div>
        <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "14px" }}>{lobbyPlayerCount} Schüler/in{lobbyPlayerCount !== 1 ? "nen" : ""} in der Lobby</div>
      </div>
    </div>
  );

  if (sebRequired) return (
    <div style={S.center}>
      <div style={{ ...S.card, maxWidth: "480px" }}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>🔒</div>
        <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 16px" }}>Safe Exam Browser erforderlich</h2>
        <a href="sebs://quickest.lovable.app/?role=student" style={{ display: "block", width: "100%", padding: "14px", background: "#7c3aed", color: "#fff", borderRadius: "12px", fontWeight: 700, fontSize: "15px", textAlign: "center", textDecoration: "none", marginBottom: "12px", boxSizing: "border-box" }}>🔒 Safe Exam Browser starten</a>
        <button onClick={() => onFinish()} style={{ width: "100%", padding: "12px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: "12px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Zurück zum Dashboard</button>
      </div>
    </div>
  );

  if (!assignment) return (
    <div style={S.center}>
      <div style={S.card}>
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>📭</div>
        <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Kein aktiver Test</h2>
        <p style={{ color: "#64748b", marginBottom: "28px", fontSize: "15px" }}>Für deine Klasse gibt es aktuell keinen aktiven Test.</p>
        <button onClick={() => onFinish()} style={{ padding: "14px 32px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "16px", cursor: "pointer", width: "100%" }}>Abmelden</button>
      </div>
    </div>
  );

  if (submitted) return (
    <div style={S.center}>
      <div style={S.card}>
        <div style={{ fontSize: "72px", marginBottom: "16px" }}>✅</div>
        <h2 style={{ fontSize: "26px", fontWeight: 800, color: "#0f172a", margin: "0 0 10px" }}>Test abgegeben!</h2>
        <p style={{ color: "#64748b", marginBottom: "28px", fontSize: "15px", lineHeight: 1.5 }}>Deine Antworten wurden gespeichert.</p>
        <button onClick={() => onFinish()} style={{ padding: "14px 32px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "16px", cursor: "pointer", width: "100%" }}>Fertig</button>
      </div>
    </div>
  );

  const realQuestions = flattenQuestions(questions).filter(q => q.type !== "section");
  const answeredCount = realQuestions.filter(q => {
    if (q.type === "fill_blank" && q.blanks?.length > 0) return Array.isArray(answers[q.id]) && answers[q.id].some(a => a?.trim());
    return answers[q.id] !== undefined && answers[q.id] !== "";
  }).length;

  const renderQuestionInput = (q) => {
    if (q.type === "multiple_choice") {
      const multiCorrect = (q.correctAnswers?.length || 0) > 1;
      const filledOptions = (q.options || []).filter(o => o?.trim() !== "");
      const currentAnswers = Array.isArray(answers[q.id]) ? answers[q.id] : (answers[q.id] != null ? [answers[q.id]] : []);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {multiCorrect && <div style={{ fontSize: "11px", color: "#2563a8", fontWeight: 600, background: "#eff6ff", borderRadius: "5px", padding: "3px 8px", alignSelf: "flex-start" }}>☑ Mehrere Antworten möglich</div>}
          {filledOptions.map((opt, i) => {
            const selected = currentAnswers.map(Number).includes(i);
            return <button key={i} onClick={() => { if (multiCorrect) { const next = selected ? currentAnswers.filter(x => Number(x) !== i) : [...currentAnswers, i]; setAnswers(a => ({ ...a, [q.id]: next })); } else { setAnswers(a => ({ ...a, [q.id]: [i] })); } }} style={{ padding: "10px 14px", border: `2px solid ${selected ? "#2563a8" : "#e2e8f0"}`, borderRadius: "8px", background: selected ? "#2563a8" : "#f8fafc", color: selected ? "#fff" : "#374151", cursor: "pointer", fontWeight: selected ? 700 : 500, fontSize: "14px", textAlign: "left", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "8px" }}><span style={{ width: "22px", height: "22px", borderRadius: multiCorrect ? "4px" : "50%", border: `2px solid ${selected ? "rgba(255,255,255,0.5)" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>{selected ? "✓" : String.fromCharCode(65 + i)}</span>{opt}</button>;
          })}
        </div>
      );
    }
    if (q.type === "true_false") return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>{["Wahr", "Falsch"].map((opt, i) => <button key={i} onClick={() => setAnswers(a => ({ ...a, [q.id]: i }))} style={{ padding: "12px", border: `2px solid ${answers[q.id] === i ? "#2563a8" : "#e2e8f0"}`, borderRadius: "8px", background: answers[q.id] === i ? "#2563a8" : "#f8fafc", color: answers[q.id] === i ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: "14px", fontFamily: "inherit" }}>{opt}</button>)}</div>;
    if (q.type === "open" || q.type === "qa") return <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="Deine Antwort..." rows={3} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e2e8f0", borderRadius: "8px", fontSize: "14px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", color: "#0f172a", background: "#fff" }} />;
    if (q.type === "fill_blank") {
      const text = q.fullText || q.text || "";
      if ((q.blanks || []).length > 0 && text.includes("[Lücke]")) {
        return <div style={{ fontSize: "15px", lineHeight: 2.5, background: "rgba(255,255,255,0.8)", borderRadius: "10px", padding: "14px", color: "#0f172a" }}>{text.split("[Lücke]").map((part, i, arr) => <span key={i}>{part}{i < arr.length - 1 && <input value={(answers[q.id] || [])[i] || ""} onChange={e => { const cur = Array.isArray(answers[q.id]) ? [...answers[q.id]] : []; cur[i] = e.target.value; setAnswers(a => ({ ...a, [q.id]: cur })); }} placeholder="___" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ display: "inline-block", width: "110px", padding: "4px 8px", border: "none", borderBottom: "3px solid #2563a8", background: "transparent", fontSize: "15px", textAlign: "center", fontFamily: "inherit", margin: "0 4px", outline: "none" }} />}</span>)}</div>;
      }
      return <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="Deine Antwort..." rows={3} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e2e8f0", borderRadius: "8px", fontSize: "14px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />;
    }
    if (q.type === "assignment") return <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{(q.pairs || []).map((pair, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.8)", borderRadius: "8px", padding: "8px 12px" }}><span style={{ fontWeight: 700, fontSize: "14px", minWidth: "80px" }}>{pair.left}</span><span style={{ color: "#94a3b8", fontSize: "16px" }}>→</span><select value={(answers[q.id] || {})[i] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: { ...(a[q.id] || {}), [i]: e.target.value } }))} style={{ flex: 1, padding: "8px 10px", border: "2px solid #e5e7eb", borderRadius: "7px", fontSize: "14px", background: "#fff", fontFamily: "inherit" }}><option value="">– auswählen –</option>{(q.pairs || []).map((p, j) => <option key={j} value={p.right}>{p.right}</option>)}</select></div>)}</div>;
    if (q.type === "flashcard") return <div><div style={{ background: "#f8fafc", borderRadius: "10px", padding: "16px", textAlign: "center", marginBottom: "10px", border: "2px solid #e2e8f0" }}><div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>A-SEITE</div>{q.cardFrontMedia ? <img src={q.cardFrontMedia} alt="A-Seite" style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "8px", objectFit: "contain" }} /> : <div style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>{q.cardFront}</div>}</div><input value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="B-Seite eingeben..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ width: "100%", padding: "12px", border: "2px solid #e2e8f0", borderRadius: "8px", fontSize: "15px", textAlign: "center", fontFamily: "inherit", boxSizing: "border-box" }} /></div>;
    return null;
  };

  return (
    <div style={{ ...S.page, background: "#f1f5f9" }}>
      <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "2px solid #e2e8f0", zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: "17px", color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>⚡ {assignment.title}</div>
            <div style={{ fontSize: "13px", color: "#64748b" }}>{currentUser.username} · {answeredCount}/{realQuestions.length} beantwortet</div>
          </div>
          {timeLeft !== null && (
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: "32px", fontWeight: 900, color: timeColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{formatTime(timeLeft)}</div>
              <div style={{ height: "5px", background: "#e2e8f0", borderRadius: "4px", width: "90px", marginTop: "5px" }}><div style={{ height: "5px", borderRadius: "4px", background: timeColor, width: `${timePercent}%`, transition: "width 1s linear" }} /></div>
            </div>
          )}
          <button onClick={() => setShowConfirm(true)} style={{ padding: "12px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer", flexShrink: 0 }}>Abgeben</button>
        </div>
        {tabSwitchCount > 0 && <div style={{ background: "#fef2f2", borderTop: "1px solid #fecaca", padding: "6px 20px", fontSize: "12px", color: "#dc2626", fontWeight: 600, textAlign: "center" }}>⚠️ {tabSwitchCount}× Tab/App-Wechsel erkannt — wird dem Lehrer gemeldet</div>}
      </div>

      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px 16px 40px" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#64748b", marginBottom: "6px" }}><span>Fortschritt</span><span>{answeredCount} / {realQuestions.length}</span></div>
          <div style={{ height: "6px", background: "#e2e8f0", borderRadius: "6px" }}><div style={{ height: "6px", borderRadius: "6px", background: "#2563a8", width: `${realQuestions.length > 0 ? (answeredCount / realQuestions.length) * 100 : 0}%`, transition: "width 0.3s" }} /></div>
        </div>

        {(() => {
          let sectionCounter = 0;
          let globalTaskCounter = 0;
          return questions.map((q, index) => {
            if (q.type === "section") {
              sectionCounter++;
              const currentSectionNum = sectionCounter;
              const taskStartNum = globalTaskCounter + 1;
              globalTaskCounter += (q.tasks || []).length;
              return (
                <div key={q.id} style={{ marginBottom: "24px", marginTop: index > 0 ? "24px" : 0, background: "linear-gradient(135deg, #1e3a5f, #2563a8)", borderRadius: "18px", padding: "20px 16px 16px", color: "#fff" }}>
                  <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                      <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: "8px", padding: "2px 10px", fontSize: "13px", fontWeight: 800 }}>Abschnitt {currentSectionNum}</span>
                      {q.sectionTitle && <div style={{ fontSize: "19px", fontWeight: 800 }}>{q.sectionTitle}</div>}
                    </div>
                    {q.sectionInstruction && <div style={{ fontSize: "14px", color: "#fff", background: "rgba(255,255,255,0.18)", borderRadius: "8px", padding: "8px 12px", marginBottom: q.sectionText?.replace(/<[^>]*>/g, "").trim() ? "12px" : 0, fontWeight: 500 }}>{q.sectionInstruction}</div>}
                    {q.sectionText?.replace(/<[^>]*>/g, "").trim() && <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: "12px", padding: "16px", fontSize: "15px", lineHeight: 1.8, marginTop: "8px", wordBreak: "break-word", color: "#fff" }} dangerouslySetInnerHTML={{ __html: q.sectionText }} />}
                  </div>
                  {(q.tasks || []).map((task, tIdx) => {
                    const globalTaskNum = taskStartNum + tIdx;
                    return (
                      <div key={task.id} style={{ background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "12px", marginBottom: "10px", border: "1px solid rgba(255,255,255,0.12)" }}>
                        <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: "8px", padding: "10px 14px", marginBottom: "10px" }}>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: task.taskInstruction ? "5px" : 0 }}>Aufgabe {globalTaskNum}{task.taskTitle ? `: ${task.taskTitle}` : ""}</div>
                          {task.taskInstruction && <div style={{ fontSize: "13px", color: "#e2e8f0", fontStyle: "italic", lineHeight: 1.5 }}>{task.taskInstruction}</div>}
                        </div>
                        {task.taskText?.replace(/<[^>]*>/g, "").trim() && <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: "10px", padding: "14px 16px", marginBottom: "10px", fontSize: "14px", lineHeight: 1.8, color: "#fff", wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: task.taskText }} />}
                        {(task.questions || []).map((tq, tqIdx) => {
                          const isAns = Array.isArray(answers[tq.id]) ? answers[tq.id].length > 0 : answers[tq.id] !== undefined && answers[tq.id] !== "";
                          return (
                            <div key={tq.id} style={{ background: "#fff", borderRadius: "10px", padding: "14px 16px", marginBottom: "6px", border: `2px solid ${isAns ? "#bfdbfe" : "#e2e8f0"}` }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ background: isAns ? "#2563a8" : "#64748b", color: "#fff", borderRadius: "6px", padding: "2px 8px", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{globalTaskNum}.{tqIdx + 1}</span>
                                  {(tq.type === "qa" || tq.type === "open") && tq.text?.includes("<") ? <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: tq.text }} /> : <span style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>{tq.text}</span>}
                                </div>
                                <span style={{ fontSize: "11px", color: "#94a3b8", background: "#f1f5f9", borderRadius: "5px", padding: "2px 7px", flexShrink: 0, marginLeft: "8px" }}>{tq.points} Pkt.</span>
                              </div>
                              {renderQuestionInput(tq)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            }
            const qIndex = questions.slice(0, index).filter(x => x.type !== "section").length;
            const isAnswered = q.type === "fill_blank" && q.blanks?.length > 0 ? Array.isArray(answers[q.id]) && answers[q.id].some(a => a?.trim()) : q.type === "multiple_choice" ? (Array.isArray(answers[q.id]) ? answers[q.id].length > 0 : answers[q.id] !== undefined && answers[q.id] !== "") : answers[q.id] !== undefined && answers[q.id] !== "";
            return (
              <div key={q.id} style={{ background: assignment.anti_cheat ? COLORS[qIndex % COLORS.length] : "#fff", borderRadius: "16px", padding: "22px", marginBottom: "14px", border: isAnswered ? "2px solid #bfdbfe" : "2px solid #e2e8f0", transition: "border-color 0.2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", gap: "12px" }}>
                  <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flex: 1 }}>
                    <span style={{ background: isAnswered ? "#2563a8" : "#64748b", color: "#fff", borderRadius: "8px", padding: "4px 12px", fontSize: "14px", fontWeight: 700, flexShrink: 0 }}>{qIndex + 1}</span>
                    <span style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", lineHeight: 1.5 }}>{q.text}</span>
                  </div>
                  <span style={{ fontSize: "13px", color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0, background: "#f1f5f9", borderRadius: "6px", padding: "3px 8px" }}>{q.points} Pkt.</span>
                </div>
                {(q.type === "open" || q.type === "qa") && <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="Deine Antwort..." rows={5} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ width: "100%", padding: "14px", border: "2px solid rgba(0,0,0,0.12)", borderRadius: "12px", fontSize: "15px", resize: "vertical", background: "rgba(255,255,255,0.8)", fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.6, color: "#0f172a" }} />}
                {q.type === "multiple_choice" && (() => {
                  const multiCorrect = (q.correctAnswers?.length || 0) > 1;
                  const filledOptions = q.options.filter(o => o.trim() !== "");
                  const currentAnswers = Array.isArray(answers[q.id]) ? answers[q.id] : (answers[q.id] != null ? [answers[q.id]] : []);
                  return <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{multiCorrect && <div style={{ fontSize: "12px", color: "#2563a8", fontWeight: 600, background: "#eff6ff", borderRadius: "6px", padding: "4px 10px", alignSelf: "flex-start" }}>☑ Mehrere Antworten möglich</div>}{filledOptions.map((opt, i) => { const selected = currentAnswers.map(Number).includes(i); return <button key={i} onClick={() => { if (multiCorrect) { const next = selected ? currentAnswers.filter(x => Number(x) !== i) : [...currentAnswers, i]; setAnswers(a => ({ ...a, [q.id]: next })); } else { setAnswers(a => ({ ...a, [q.id]: [i] })); } }} style={{ padding: "16px 18px", border: `2px solid ${selected ? "#2563a8" : "rgba(0,0,0,0.1)"}`, borderRadius: "12px", background: selected ? "#2563a8" : "rgba(255,255,255,0.8)", color: selected ? "#fff" : "#374151", cursor: "pointer", fontWeight: selected ? 700 : 500, fontSize: "15px", textAlign: "left", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "12px" }}><span style={{ width: "28px", height: "28px", borderRadius: multiCorrect ? "4px" : "50%", border: `2px solid ${selected ? "rgba(255,255,255,0.5)" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>{selected ? "✓" : String.fromCharCode(65 + i)}</span>{opt}</button>; })}</div>;
                })()}
                {q.type === "true_false" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>{["Wahr", "Falsch"].map((opt, i) => <button key={i} onClick={() => setAnswers(a => ({ ...a, [q.id]: i }))} style={{ padding: "18px", border: `2px solid ${answers[q.id] === i ? "#2563a8" : "rgba(0,0,0,0.1)"}`, borderRadius: "12px", background: answers[q.id] === i ? "#2563a8" : "rgba(255,255,255,0.8)", color: answers[q.id] === i ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: "17px", fontFamily: "inherit" }}>{opt}</button>)}</div>}
                {q.type === "flashcard" && <div><div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", padding: "24px", marginBottom: "14px", border: "2px solid rgba(0,0,0,0.08)", textAlign: "center" }}><div style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8", letterSpacing: "1px", marginBottom: "10px" }}>A-SEITE</div>{q.cardFrontMedia ? <img src={q.cardFrontMedia} alt="A-Seite" style={{ maxWidth: "100%", maxHeight: "220px", borderRadius: "10px", objectFit: "contain" }} /> : <div style={{ fontSize: "26px", fontWeight: 800, color: "#0f172a" }}>{q.cardFront}</div>}</div><input value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="B-Seite eingeben..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ width: "100%", padding: "16px", border: "2px solid rgba(0,0,0,0.12)", borderRadius: "12px", fontSize: "18px", background: "rgba(255,255,255,0.8)", fontFamily: "inherit", boxSizing: "border-box", textAlign: "center" }} /></div>}
                {q.type === "fill_blank" && <div>{(q.blanks || []).length > 0 ? <div style={{ fontSize: "16px", lineHeight: 2.5, background: "rgba(255,255,255,0.8)", borderRadius: "12px", padding: "16px", color: "#0f172a" }}>{(q.fullText || q.text || "").split("[Lücke]").map((part, i, arr) => <span key={i}>{part}{i < arr.length - 1 && <input value={(answers[q.id] || [])[i] || ""} onChange={e => { const cur = Array.isArray(answers[q.id]) ? [...answers[q.id]] : []; cur[i] = e.target.value; setAnswers(a => ({ ...a, [q.id]: cur })); }} placeholder="___" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ display: "inline-block", width: "110px", padding: "4px 8px", border: "none", borderBottom: "3px solid #2563a8", background: "transparent", fontSize: "16px", textAlign: "center", fontFamily: "inherit", margin: "0 4px", outline: "none" }} />}</span>)}</div> : <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} placeholder="Deine Antwort..." rows={3} style={{ width: "100%", padding: "14px", border: "2px solid rgba(0,0,0,0.12)", borderRadius: "12px", fontSize: "15px", resize: "vertical", background: "rgba(255,255,255,0.8)", fontFamily: "inherit", boxSizing: "border-box" }} />}</div>}
                {q.type === "assignment" && <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>{(q.pairs || []).map((pair, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.8)", borderRadius: "10px", padding: "10px 14px" }}><span style={{ fontWeight: 700, fontSize: "15px", minWidth: "80px" }}>{pair.left}</span><span style={{ color: "#94a3b8", fontSize: "18px" }}>→</span><select value={(answers[q.id] || {})[i] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: { ...(a[q.id] || {}), [i]: e.target.value } }))} style={{ flex: 1, padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "15px", background: "#fff", fontFamily: "inherit" }}><option value="">– auswählen –</option>{(q.pairs || []).map((p, j) => <option key={j} value={p.right}>{p.right}</option>)}</select></div>)}</div>}
              </div>
            );
          });
        })()}

        <button onClick={() => setShowConfirm(true)} style={{ width: "100%", padding: "18px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "14px", fontWeight: 800, fontSize: "17px", cursor: "pointer", marginTop: "8px" }}>Test abgeben</button>
      </div>

      {/* PAUSE OVERLAY */}
      {isPaused && !isEnded && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 500, backdropFilter: "blur(4px)" }}>
          <div style={{ textAlign: "center", color: "#fff", padding: "40px" }}>
            <div style={{ fontSize: "64px", marginBottom: "20px" }}>⏸</div>
            <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "10px" }}>Test pausiert</div>
            <div style={{ fontSize: "16px", color: "rgba(255,255,255,0.65)", maxWidth: "320px", lineHeight: 1.6 }}>Deine Lehrkraft hat den Test kurz angehalten. Bitte warte — er wird gleich fortgesetzt.</div>
            <div style={{ marginTop: "28px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
              {[0, 0.3, 0.6].map((delay, i) => <div key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#60a5fa", animation: `qtpulse 1.5s ease-in-out ${delay}s infinite` }} />)}
            </div>
          </div>
          <style>{`@keyframes qtpulse { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1.3)} }`}</style>
        </div>
      )}

      {/* ENDED OVERLAY */}
      {isEnded && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.95)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 600, backdropFilter: "blur(4px)" }}>
          <div style={{ textAlign: "center", color: "#fff", padding: "40px", maxWidth: "400px" }}>
            <div style={{ fontSize: "64px", marginBottom: "20px" }}>🏁</div>
            <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "10px" }}>Test beendet</div>
            <div style={{ fontSize: "16px", color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: "24px" }}>
              Deine Lehrkraft hat den Test beendet. Deine Antworten wurden gespeichert.
            </div>
            <button onClick={() => onFinish()} style={{ padding: "14px 32px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "16px", cursor: "pointer" }}>
              Zum Dashboard →
            </button>
          </div>
        </div>
      )}

      {showCheatWarning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "380px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "52px", marginBottom: "12px" }}>⚠️</div>
            <h3 style={{ fontSize: "20px", fontWeight: 800, color: "#dc2626", margin: "0 0 10px" }}>Tab-Wechsel erkannt!</h3>
            <p style={{ color: "#374151", fontSize: "14px", marginBottom: "8px", lineHeight: 1.5 }}>Du hast den Test-Tab verlassen. Dies wurde protokolliert.</p>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>Bisher: <strong style={{ color: "#dc2626" }}>{tabSwitchCount}×</strong> erkannt</p>
            <button onClick={() => setShowCheatWarning(false)} style={{ width: "100%", padding: "14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>Verstanden — zurück zum Test</button>
          </div>
        </div>
      )}

      {showConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "24px", padding: "36px 32px", maxWidth: "420px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "56px", marginBottom: "16px" }}>🤔</div>
            <h3 style={{ fontSize: "22px", fontWeight: 800, margin: "0 0 10px", color: "#0f172a" }}>Schon fertig?</h3>
            <p style={{ color: "#64748b", marginBottom: "10px", fontSize: "15px", lineHeight: 1.5 }}>Du hast <strong>{answeredCount} von {realQuestions.length}</strong> Fragen beantwortet.</p>
            <p style={{ color: "#94a3b8", marginBottom: "28px", fontSize: "14px" }}>Nach dem Abgeben kannst du keine Antworten mehr ändern.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button onClick={handleSubmit} disabled={submitting} style={{ padding: "16px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "12px", fontWeight: 800, fontSize: "16px", cursor: submitting ? "not-allowed" : "pointer" }}>{submitting ? "Wird gespeichert..." : "Ja, jetzt abgeben"}</button>
              <button onClick={() => setShowConfirm(false)} style={{ padding: "16px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "12px", fontWeight: 600, fontSize: "16px", cursor: "pointer" }}>Zurück zum Test</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
