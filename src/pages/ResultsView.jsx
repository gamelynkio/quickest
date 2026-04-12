import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

// KI-Korrektur für offene Antworten
const aiCorrectOpenQuestions = async (submission, assignmentData) => {
  const corrections = { ...(submission.ai_corrections || {}) };
  const questions = assignmentData?.question_data || [];
  const gradingMode = assignmentData?.grading_mode || "standard";

  // Alle offenen Fragen herausfinden (auch in sections/tasks)
  const flattenQuestions = (qs) => {
    const result = [];
    for (const q of qs) {
      if (q.type === "section") {
        for (const task of (q.tasks || [])) {
          for (const tq of (task.questions || [])) result.push(tq);
        }
      } else {
        result.push(q);
      }
    }
    return result;
  };

  const allQuestions = flattenQuestions(questions);
  const openQuestions = allQuestions.filter(q => (q.type === "open" || q.type === "qa") || q.type === "qa");

  if (openQuestions.length === 0) return { corrections, changed: false };

  const gradingModeText = {
    content: "Bewerte NUR den inhaltlichen Kern. Rechtschreibung, Grammatik und Zeichensetzung sind vollkommen egal.",
    standard: "Bewerte primär den Inhalt. Grobe Rechtschreib- oder Grammatikfehler können leicht abgezogen werden, spielen aber keine große Rolle.",
    strict: "Bewerte Inhalt UND Sprachform. Rechtschreibfehler, Grammatikfehler und falsche Zeichensetzung führen zu Punktabzügen.",
  }[gradingMode] || "";

  let changed = false;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  for (const q of openQuestions) {
    const existingCorrection = corrections[q.id];
    // Nur korrigieren wenn noch nicht KI-bewertet (needsReview = true und kein aiReviewed-Flag)
    if (!existingCorrection?.needsReview || existingCorrection?.aiReviewed) continue;

    const studentAnswer = submission.answers?.[q.id] || "";
    if (!studentAnswer.trim()) {
      corrections[q.id] = {
        ...existingCorrection,
        points: 0,
        correct: false,
        comment: "Keine Antwort gegeben.",
        aiReviewed: true,
        needsReview: false,
      };
      changed = true;
      continue;
    }

    const prompt = `Du bist ein Schullehrer und bewertest die folgende Schülerantwort auf Deutsch.

Frage: ${q.text}
Musterlösung: ${q.solution || "(keine Musterlösung hinterlegt — bewerte inhaltlich nach bestem Ermessen)"}
Maximale Punktzahl: ${q.points}
Schülerantwort: ${studentAnswer}

Bewertungsregeln: ${gradingModeText}

WICHTIGE HINWEISE zur Musterlösung:
- Wörter in runden Klammern () sind OPTIONAL und müssen NICHT genannt werden. Beispiel: "(she's) five" bedeutet, "five" allein ist vollständig richtig. "chocolate (with nuts)" bedeutet, "chocolate" allein reicht für volle Punktzahl.
- Wenn die Schülerantwort den Kerninhalt der Musterlösung enthält, gilt sie als korrekt — auch wenn sie kürzer formuliert ist.
- Wenn keine Musterlösung hinterlegt ist, bewerte ob die Antwort inhaltlich sinnvoll und vollständig zur Frage passt.

TEILBEPUNKTUNG:
${(q.partialPoints || []).length > 0
  ? `Der Lehrer hat folgende verbindliche Bewertungskriterien festgelegt — halte dich EXAKT daran:
${(q.partialPoints).map(p => `- ${p.points} Punkt${Number(p.points) !== 1 ? "e" : ""} für: ${p.description}`).join("\n")}
Vergib nur die Punkte, die der Schüler laut diesen Kriterien verdient hat. Summe darf maximal ${q.points} sein.`
  : `- Vergib IMMER anteilige Punkte wenn die Antwort teilweise korrekt ist.
- Nur bei komplett falscher oder komplett richtiger Antwort darfst du 0 oder volle Punktzahl vergeben.
- Bei ${q.points} Punkt${Number(q.points) !== 1 ? "en" : ""} sind Schritte von 0.5 möglich.
- Erkläre kurz was richtig war und was gefehlt hat (oder warum volle/keine Punkte).`}

Gib deine Bewertung NUR als JSON zurück, ohne weiteren Text:
{"points": <Zahl, max ${q.points}, Vielfaches von 0.5>, "comment": "<was war richtig, was hat gefehlt — max 2 Sätze>"}`;

    try {
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`,
          "apikey": supabaseAnonKey,
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const points = Math.min(Math.max(0, Number(parsed.points) || 0), Number(q.points));

      corrections[q.id] = {
        ...existingCorrection,
        points,
        correct: points >= Number(q.points),
        comment: `🤖 ${parsed.comment}`,
        aiReviewed: true,
        needsReview: false,
        maxPoints: Number(q.points),
      };
      changed = true;
    } catch (e) {
      console.error("KI-Korrektur fehlgeschlagen für Frage", q.id, e);
    }
  }

  return { corrections, changed };
};

export default function ResultsView({ navigate, onLogout, currentUser, assignment }) {
  const [submissions, setSubmissions] = useState([]);
  const [groupUsernames, setGroupUsernames] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [makeupModal, setMakeupModal] = useState(false);
  const [makeupSelected, setMakeupSelected] = useState(new Set());
  const [makeupTemplateId, setMakeupTemplateId] = useState("");
  const [makeupTimeLimit, setMakeupTimeLimit] = useState(20);
  const [makeupTimingMode, setMakeupTimingMode] = useState("lobby");
  const [makeupAntiCheat, setMakeupAntiCheat] = useState(false);
  const [makeupRequireSeb, setMakeupRequireSeb] = useState(true);
  const [creatingMakeup, setCreatingMakeup] = useState(false);
  const [assignmentData, setAssignmentData] = useState(null);

  useEffect(() => {
    if (!assignment?.id) return;
    fetchAll();
    const channel = supabase
      .channel(`submissions-${assignment.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `assignment_id=eq.${assignment.id}` }, () => fetchSubmissions())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [assignment]);

  // Beim Laden: unreviewte Submissions automatisch KI-korrigieren
  useEffect(() => {
    if (!assignmentData || submissions.length === 0) return;
    const pending = submissions.filter(s =>
      !s.reviewed && Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
    );
    if (pending.length === 0) return;
    setAiRunning(true);
    setAiProgress(`🤖 KI korrigiert ${pending.length} Abgabe${pending.length !== 1 ? "n" : ""} automatisch...`);
    (async () => {
      for (let i = 0; i < pending.length; i++) {
        const s = pending[i];
        if (pending.length > 1) setAiProgress(`🤖 KI korrigiert ${i + 1}/${pending.length}: ${s.username}...`);
        const { corrections, changed } = await aiCorrectOpenQuestions(s, assignmentData);
        if (!changed) continue;
        let newScore = 0;
        for (const [qId, correction] of Object.entries(corrections)) {
          const ov = (s.manual_overrides || {})[qId];
          newScore += ov !== undefined ? Number(ov) : (correction.points !== null && correction.points !== undefined ? Number(correction.points) : 0);
        }
        const percent = (newScore / (s.total_points || 1)) * 100;
        const gs = [...(assignmentData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
        let newGrade = "6";
        for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
        const hasStillOpen = Object.values(corrections).some(c => c.needsReview && !c.aiReviewed);
        await supabase.from("submissions").update({
          ai_corrections: corrections,
          score: newScore,
          grade: newGrade,
          reviewed: !hasStillOpen,
        }).eq("id", s.id);
        setSubmissions(prev => prev.map(sub =>
          sub.id === s.id ? { ...sub, ai_corrections: corrections, score: newScore, grade: newGrade, reviewed: !hasStillOpen } : sub
        ));
        if (selectedSubmission?.id === s.id) {
          setSelectedSubmission(prev => ({ ...prev, ai_corrections: corrections, score: newScore, grade: newGrade, reviewed: !hasStillOpen }));
        }
      }
      setAiProgress("✅ KI-Korrektur abgeschlossen!");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); }, 3000);
    })();
  }, [assignmentData, submissions.length]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchSubmissions(), fetchGroup(), fetchTemplates(), fetchAssignmentData()]);
    setLoading(false);
  };

  const fetchAssignmentData = async () => {
    const { data } = await supabase.from("assignments").select("*").eq("id", assignment.id).single();
    setAssignmentData(data);
  };

  const fetchSubmissions = async () => {
    const { data: makeupAssignments } = await supabase
      .from("assignments").select("id").eq("parent_assignment_id", assignment.id);
    const makeupIds = (makeupAssignments || []).map(a => a.id);
    const allIds = [assignment.id, ...makeupIds];
    const { data } = await supabase.from("submissions").select("*, assignments(title)")
      .in("assignment_id", allIds).order("submitted_at", { ascending: false });
    setSubmissions(data || []);
    setLoading(false);
  };

  const fetchGroup = async () => {
    const { data } = await supabase.from("groups").select("usernames").eq("id", assignment.group_id).single();
    setGroupUsernames(data?.usernames || []);
  };

  const fetchTemplates = async () => {
    const { data } = await supabase.from("templates").select("id, title").order("created_at", { ascending: false });
    setTemplates(data || []);
  };

  // KI-Korrektur für eine einzelne Abgabe ausführen
  const runAiCorrection = async (submission) => {
    setAiRunning(true);
    setAiProgress("KI bewertet offene Antworten...");
    try {
      const aData = assignmentData || assignment;
      const { corrections, changed } = await aiCorrectOpenQuestions(submission, aData);
      if (!changed) {
        setAiProgress("Alle Antworten bereits bewertet.");
        setTimeout(() => setAiProgress(""), 2000);
        setAiRunning(false);
        return;
      }
      // Punkte neu berechnen
      let newScore = 0;
      const updatedOverrides = submission.manual_overrides || {};
      for (const [qId, correction] of Object.entries(corrections)) {
        if (updatedOverrides[qId] !== undefined) newScore += Number(updatedOverrides[qId]);
        else if (correction.points !== null && correction.points !== undefined) newScore += Number(correction.points);
      }
      const totalPoints = submission.total_points || 1;
      const percent = (newScore / totalPoints) * 100;
      const gradingScale = aData?.grading_scale || [];
      const sorted = [...gradingScale].sort((a, b) => b.minPercent - a.minPercent);
      let newGrade = "6";
      for (const g of sorted) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
      const hasStillOpen = Object.values(corrections).some(c => c.needsReview);

      await supabase.from("submissions").update({
        ai_corrections: corrections,
        score: newScore,
        grade: newGrade,
        reviewed: !hasStillOpen,
      }).eq("id", submission.id);

      const updated = { ...submission, ai_corrections: corrections, score: newScore, grade: newGrade, reviewed: !hasStillOpen };
      setSubmissions(prev => prev.map(s => s.id === submission.id ? updated : s));
      setSelectedSubmission(updated);
      setAiProgress("✅ KI-Korrektur abgeschlossen!");
      setTimeout(() => setAiProgress(""), 3000);
    } catch (e) {
      setAiProgress("❌ Fehler bei der KI-Korrektur.");
      setTimeout(() => setAiProgress(""), 3000);
    }
    setAiRunning(false);
  };

  // KI-Korrektur für ALLE Abgaben auf einmal
  const runAiCorrectionAll = async () => {
    const pending = submissions.filter(s => !s.reviewed || Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed));
    if (pending.length === 0) return;
    setAiRunning(true);
    const aData = assignmentData || assignment;
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      setAiProgress(`KI bewertet ${i + 1}/${pending.length}: ${s.username}...`);
      const { corrections, changed } = await aiCorrectOpenQuestions(s, aData);
      if (!changed) continue;
      let newScore = 0;
      const updatedOverrides = s.manual_overrides || {};
      for (const [qId, correction] of Object.entries(corrections)) {
        if (updatedOverrides[qId] !== undefined) newScore += Number(updatedOverrides[qId]);
        else if (correction.points !== null && correction.points !== undefined) newScore += Number(correction.points);
      }
      const totalPoints = s.total_points || 1;
      const percent = (newScore / totalPoints) * 100;
      const gradingScale = aData?.grading_scale || [];
      const sorted = [...gradingScale].sort((a, b) => b.minPercent - a.minPercent);
      let newGrade = "6";
      for (const g of sorted) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
      const hasStillOpen = Object.values(corrections).some(c => c.needsReview);
      await supabase.from("submissions").update({
        ai_corrections: corrections,
        score: newScore,
        grade: newGrade,
        reviewed: !hasStillOpen,
      }).eq("id", s.id);
      const updated = { ...s, ai_corrections: corrections, score: newScore, grade: newGrade, reviewed: !hasStillOpen };
      setSubmissions(prev => prev.map(sub => sub.id === s.id ? updated : sub));
      if (selectedSubmission?.id === s.id) setSelectedSubmission(updated);
    }
    setAiProgress(`✅ Alle ${pending.length} Abgaben bewertet!`);
    setTimeout(() => setAiProgress(""), 4000);
    setAiRunning(false);
  };

  const saveOverrides = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    const updatedOverrides = { ...selectedSubmission.manual_overrides, ...overrides };
    const corrections = selectedSubmission.ai_corrections || {};
    let newScore = 0;
    for (const [qId, correction] of Object.entries(corrections)) {
      if (updatedOverrides[qId] !== undefined) newScore += Number(updatedOverrides[qId]);
      else if (correction.points !== null && correction.points !== undefined) newScore += Number(correction.points);
    }
    const totalPoints = selectedSubmission.total_points || 1;
    const percent = (newScore / totalPoints) * 100;
    const { data: aData } = await supabase.from("assignments").select("grading_scale").eq("id", selectedSubmission.assignment_id).single();
    const gradingScale = aData?.grading_scale || [];
    const sorted = [...gradingScale].sort((a, b) => b.minPercent - a.minPercent);
    let newGrade = "6";
    for (const g of sorted) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }

    await supabase.from("submissions").update({ manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true }).eq("id", selectedSubmission.id);
    setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? { ...s, manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true } : s));
    setSelectedSubmission(prev => ({ ...prev, manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true }));
    setOverrides({});
    setSaving(false);
  };

  const createMakeupTest = async () => {
    if (!makeupTemplateId || makeupSelected.size === 0) return;
    setCreatingMakeup(true);
    const { data: t } = await supabase.from("templates").select("*").eq("id", makeupTemplateId).single();
    await supabase.from("assignments").insert({
      template_id: Number(makeupTemplateId),
      group_id: assignment.group_id,
      teacher_id: currentUser?.id,
      title: `${t.title} (Nachtest)`,
      status: "aktiv",
      time_limit: makeupTimeLimit * 60,
      timing_mode: makeupTimingMode,
      anti_cheat: makeupAntiCheat,
      require_seb: makeupRequireSeb,
      question_data: t.question_data,
      grading_scale: t.grading_scale || assignment.grading_scale,
      parent_assignment_id: assignment.id,
      makeup_usernames: [...makeupSelected],
    });
    setCreatingMakeup(false);
    setMakeupModal(false);
    setMakeupSelected(new Set());
    setMakeupTemplateId("");
    await fetchSubmissions();
  };

  const submittedUsernames = new Set(submissions.map(s => s.username));
  const relevantUsernames = assignment?.makeup_usernames?.length ? assignment.makeup_usernames : groupUsernames;
  const missingStudents = relevantUsernames.filter(u => !submittedUsernames.has(u));
  const pendingAiCount = submissions.filter(s => Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)).length;
  const avg = submissions.length > 0
    ? (submissions.reduce((s, r) => s + ((r.score || 0) / (r.total_points || 1)) * 100, 0) / submissions.length).toFixed(1)
    : null;

  if (!assignment) return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", color: "#94a3b8", textAlign: "center" }}>Kein Test ausgewählt.</div>
    </TeacherLayout>
  );

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ marginBottom: "28px" }}>
          <button onClick={() => navigate("dashboard")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", marginBottom: "8px", padding: 0 }}>← Zurück zum Dashboard</button>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{assignment.title}</h1>
          <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
            {submissions.length} Abgaben{avg ? ` · Ø ${avg}%` : ""}
            <button onClick={fetchSubmissions} style={{ marginLeft: "12px", background: "none", border: "none", color: "#2563a8", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>🔄 Aktualisieren</button>
          </p>
        </div>

        {/* KI-Fortschritt */}
        {aiProgress && (
          <div style={{ background: aiProgress.startsWith("✅") ? "#f0fdf4" : "#f0f7ff", border: `1px solid ${aiProgress.startsWith("✅") ? "#bbf7d0" : "#bfdbfe"}`, borderRadius: "10px", padding: "10px 16px", marginBottom: "16px", fontSize: "13px", color: aiProgress.startsWith("✅") ? "#16a34a" : "#1e3a5f", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
            {!aiProgress.startsWith("✅") && (
              <div style={{ width: "14px", height: "14px", border: "2px solid #bfdbfe", borderTop: "2px solid #2563a8", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
            )}
            {aiProgress}
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : (
          <>
            {missingStudents.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "14px", padding: "18px 20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>
                    ⚠️ {missingStudents.length} Schüler/in{missingStudents.length !== 1 ? "nen haben" : " hat"} nicht teilgenommen
                  </div>
                  <button onClick={() => { setMakeupModal(true); setMakeupSelected(new Set(missingStudents)); setMakeupTemplateId(""); setMakeupTimeLimit(Math.round((assignment.time_limit || 1200) / 60)); setMakeupTimingMode("lobby"); setMakeupAntiCheat(assignment.anti_cheat || false); }}
                    style={{ padding: "7px 14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                    + Nachtest erstellen
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {missingStudents.map(u => (
                    <span key={u} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: "6px", padding: "4px 10px", fontSize: "13px", fontWeight: 600, color: "#374151" }}>{u}</span>
                  ))}
                </div>
              </div>
            )}

            {submissions.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center", border: "1px solid #e2e8f0", color: "#94a3b8" }}>
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>📭</div>
                <div style={{ fontWeight: 600 }}>Noch keine Abgaben</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: selectedSubmission ? "1fr 1fr" : "1fr", gap: "20px" }}>
                <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Schüler/in", "Punkte", "Note", "Status", ""].map(h => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s, i) => {
                        const hasAiPending = Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed);
                        return (
                          <tr key={s.id} style={{ borderBottom: i < submissions.length - 1 ? "1px solid #f8fafc" : "none", background: selectedSubmission?.id === s.id ? "#f0f7ff" : "transparent" }}>
                            <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>
                              {s.username}
                              {s.cheat_log?.length > 0 && (
                                <span title={`${s.cheat_log.length}× Tab-Wechsel`} style={{ marginLeft: "6px", fontSize: "11px", background: "#fef2f2", color: "#dc2626", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>⚠️ {s.cheat_log.length}×</span>
                              )}
                              {s.assignments?.title !== assignment.title && (
                                <span style={{ marginLeft: "6px", fontSize: "10px", background: "#f0f7ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px" }}>Nachtest</span>
                              )}
                            </td>
                            <td style={{ padding: "13px 16px", fontSize: "14px" }}>
                              <span style={{ fontWeight: 700 }}>{s.score ?? "–"}</span>
                              {s.total_points && <span style={{ color: "#94a3b8", fontSize: "12px" }}>/{s.total_points}</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {s.grade ? <span style={{ fontWeight: 800, fontSize: "18px", color: GRADE_COLOR[s.grade] || "#374151" }}>{s.grade}</span> : <span style={{ color: "#94a3b8" }}>–</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {s.reviewed
                                ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Geprüft</span>
                                : hasAiPending
                                ? <span style={{ background: "#eff6ff", color: "#2563a8", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }} onClick={() => runAiCorrection(s)}>🤖 KI wiederholen</span>
                                : <span style={{ background: "#fef9c3", color: "#ca8a04", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>Offen</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              <button onClick={() => { setSelectedSubmission(s); setOverrides({}); }} style={{ padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer" }}>Details</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {selectedSubmission && (
                  <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", padding: "22px", overflowY: "auto", maxHeight: "600px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>{selectedSubmission.username}</h3>
                      <div style={{ display: "flex", gap: "8px" }}>
                        {Object.values(selectedSubmission.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed) && (
                          <button onClick={() => runAiCorrection(selectedSubmission)} disabled={aiRunning}
                            style={{ padding: "7px 14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: aiRunning ? "not-allowed" : "pointer" }}>
                            {aiRunning ? "⏳ KI läuft..." : "🤖 KI korrigieren"}
                          </button>
                        )}
                        {Object.values(selectedSubmission.ai_corrections || {}).some(c => c.aiReviewed) && (
                          <button onClick={() => runAiCorrection({ ...selectedSubmission, ai_corrections: Object.fromEntries(Object.entries(selectedSubmission.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])) })} disabled={aiRunning}
                            style={{ padding: "7px 14px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: aiRunning ? "not-allowed" : "pointer" }}>
                            {aiRunning ? "⏳..." : "🔄 Neu korrigieren"}
                          </button>
                        )}
                      </div>
                    </div>
                    <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: "13px" }}>
                      Abgegeben: {new Date(selectedSubmission.submitted_at).toLocaleString("de-DE")}
                    </p>

                    {selectedSubmission.cheat_log?.length > 0 && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626", marginBottom: "6px" }}>⚠️ {selectedSubmission.cheat_log.length}× Tab/App-Wechsel erkannt</div>
                        {selectedSubmission.cheat_log.map((e, i) => (
                          <div key={i} style={{ fontSize: "12px", color: "#64748b" }}>{new Date(e.time).toLocaleTimeString("de-DE")} — Tab verlassen</div>
                        ))}
                      </div>
                    )}

                    {(() => {
                      // Originalreihenfolge der Fragen beibehalten — Object.entries sortiert numerische Keys falsch
                      const allQs = (() => {
                        const flat = [];
                        const qs = assignmentData?.question_data || assignment?.question_data || [];
                        for (const q of qs) {
                          if (q.type === "section") {
                            for (const task of (q.tasks || [])) {
                              for (const tq of (task.questions || [])) flat.push(tq);
                            }
                          } else {
                            flat.push(q);
                          }
                        }
                        return flat;
                      })();
                      const corrections = selectedSubmission.ai_corrections || {};
                      const orderedKeys = allQs.length > 0
                        ? allQs.map(q => String(q.id)).filter(id => corrections[id] !== undefined)
                        : Object.keys(corrections);
                      const missingKeys = Object.keys(corrections).filter(k => !orderedKeys.includes(k));
                      const finalKeys = [...orderedKeys, ...missingKeys];

                      return finalKeys.map((qId, i) => {
                        const correction = corrections[qId];
                        if (!correction) return null;
                      const override = overrides[qId];
                      const currentPoints = override !== undefined ? Number(override) : (selectedSubmission.manual_overrides?.[qId] !== undefined ? selectedSubmission.manual_overrides[qId] : correction.points);
                      const isAiReviewed = correction.aiReviewed;
                      const isStillOpen = correction.needsReview && !correction.aiReviewed;
                      return (
                        <div key={qId} style={{ marginBottom: "16px", background: "#f8fafc", borderRadius: "12px", padding: "14px", border: `1px solid ${correction.correct === true ? "#bbf7d0" : correction.correct === false ? "#fecaca" : isAiReviewed ? "#bfdbfe" : "#e2e8f0"}` }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                            Aufgabe {i + 1}
                            {correction.correct === true && <span style={{ color: "#16a34a" }}>✓</span>}
                            {correction.correct === false && <span style={{ color: "#dc2626" }}>✗</span>}
                            {isAiReviewed && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>🤖 KI</span>}
                            {isStillOpen && <span style={{ fontSize: "10px", background: "#fef9c3", color: "#ca8a04", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>Ausstehend</span>}
                          </div>
                          <div style={{ fontSize: "13px", color: "#374151", marginBottom: "6px" }}>
                            <em style={{ color: "#94a3b8" }}>Antwort:</em> {correction.studentAnswer ?? "–"}
                          </div>
                          {correction.comment && (
                            <div style={{ background: isStillOpen ? "#fef9c3" : isAiReviewed ? "#eff6ff" : correction.correct ? "#dcfce7" : "#fef2f2", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: isStillOpen ? "#92400e" : isAiReviewed ? "#1e40af" : correction.correct ? "#16a34a" : "#dc2626" }}>
                              {correction.comment}
                            </div>
                          )}
                          {correction.solution && (
                            <div style={{ background: "#f0f7ff", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: "#1e3a5f", border: "1px solid #bfdbfe" }}>
                              <strong>📝 Musterlösung:</strong> {correction.solution}
                            </div>
                          )}
                          {(correction.partialPoints?.length > 0) && (
                            <details style={{ marginBottom: "8px" }}>
                              <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "#64748b", userSelect: "none", padding: "2px 0" }}>📋 Bewertungsmaßstab ({correction.partialPoints.length} Kriterien)</summary>
                              <div style={{ marginTop: "6px", background: "#f8fafc", borderRadius: "6px", padding: "8px 10px", border: "1px solid #e2e8f0" }}>
                                {correction.partialPoints.map((p, pi) => (
                                  <div key={pi} style={{ fontSize: "12px", color: "#374151", display: "flex", gap: "6px", marginBottom: "3px", alignItems: "center" }}>
                                    <span style={{ background: "#eff6ff", borderRadius: "4px", padding: "1px 6px", fontWeight: 700, color: "#2563a8", flexShrink: 0 }}>{p.points} Pkt.</span>
                                    <span>{p.description}</span>
                                  </div>
                                ))}
                                <button onClick={async () => {
                                  const toReCorrect = submissions.filter(s => Object.values(s.ai_corrections || {}).some(c => c.aiReviewed));
                                  if (toReCorrect.length === 0) return;
                                  if (!window.confirm(`Alle ${toReCorrect.length} KI-bewerteten Abgaben mit dem aktuellen Maßstab neu korrigieren?`)) return;
                                  setAiRunning(true);
                                  const aData = assignmentData || assignment;
                                  for (const s of toReCorrect) {
                                    setAiProgress(`Neu korrigiere ${s.username}...`);
                                    const resetCorrections = Object.fromEntries(Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }]));
                                    const { corrections, changed } = await aiCorrectOpenQuestions({ ...s, ai_corrections: resetCorrections }, aData);
                                    if (!changed) continue;
                                    let newScore = 0;
                                    for (const [qId, c] of Object.entries(corrections)) {
                                      const ov = (s.manual_overrides || {})[qId];
                                      newScore += ov !== undefined ? Number(ov) : (c.points !== null && c.points !== undefined ? Number(c.points) : 0);
                                    }
                                    const percent = (newScore / (s.total_points || 1)) * 100;
                                    const gs = [...(aData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
                                    let newGrade = "6"; for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
                                    await supabase.from("submissions").update({ ai_corrections: corrections, score: newScore, grade: newGrade, reviewed: !Object.values(corrections).some(c => c.needsReview) }).eq("id", s.id);
                                    setSubmissions(prev => prev.map(sub => sub.id === s.id ? { ...sub, ai_corrections: corrections, score: newScore, grade: newGrade } : sub));
                                    if (selectedSubmission?.id === s.id) setSelectedSubmission(prev => ({ ...prev, ai_corrections: corrections, score: newScore, grade: newGrade }));
                                  }
                                  setAiProgress(`✅ Alle ${toReCorrect.length} Abgaben neu bewertet!`);
                                  setTimeout(() => setAiProgress(""), 4000);
                                  setAiRunning(false);
                                }} disabled={aiRunning}
                                  style={{ marginTop: "8px", padding: "5px 12px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: aiRunning ? "not-allowed" : "pointer" }}>
                                  🔄 Alle Abgaben mit diesem Maßstab neu korrigieren
                                </button>
                              </div>
                            </details>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <label style={{ fontSize: "12px", color: "#64748b" }}>Punkte:</label>
                            <input type="number" min={0} max={correction.maxPoints} step={0.5}
                              value={currentPoints ?? ""} placeholder={currentPoints === null ? "–" : ""}
                              onChange={e => setOverrides(prev => ({ ...prev, [qId]: Number(e.target.value) }))}
                              style={{ width: "64px", padding: "4px 8px", border: "2px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textAlign: "center" }} />
                            <span style={{ fontSize: "12px", color: "#94a3b8" }}>/ {correction.maxPoints}</span>
                            {overrides[qId] !== undefined && <span style={{ fontSize: "11px", background: "#fef9c3", color: "#ca8a04", borderRadius: "5px", padding: "2px 6px" }}>✏️ Geändert</span>}
                          </div>
                        </div>
                      );
                    });
                    })()}

                    <button onClick={saveOverrides} disabled={saving} style={{ width: "100%", marginTop: "8px", padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: saving ? "not-allowed" : "pointer" }}>
                      {saving ? "Wird gespeichert..." : "✓ Korrekturen speichern"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* MAKEUP TEST MODAL */}
      {makeupModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "500px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px", color: "#0f172a" }}>Nachtest erstellen</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>Ergebnisse werden dem Original-Test „{assignment.title}" zugeordnet.</p>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "8px" }}>
                Teilnehmende Schüler/innen
                <span style={{ marginLeft: "8px", fontWeight: 400, color: "#94a3b8" }}>({makeupSelected.size} ausgewählt)</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {missingStudents.map(u => {
                  const selected = makeupSelected.has(u);
                  return (
                    <button key={u} onClick={() => setMakeupSelected(prev => { const next = new Set(prev); next.has(u) ? next.delete(u) : next.add(u); return next; })}
                      style={{ padding: "8px 12px", borderRadius: "8px", cursor: "pointer", textAlign: "left", border: `2px solid ${selected ? "#2563a8" : "#e2e8f0"}`, background: selected ? "#eff6ff" : "#f8fafc", fontFamily: "inherit" }}>
                      <span style={{ fontSize: "12px", color: selected ? "#2563a8" : "#94a3b8", display: "block" }}>{selected ? "✓ Ausgewählt" : "Nicht ausgewählt"}</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? "#1e40af" : "#374151" }}>{u}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button onClick={() => setMakeupSelected(new Set(missingStudents))} style={{ fontSize: "12px", color: "#2563a8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Alle auswählen</button>
                <span style={{ color: "#e2e8f0" }}>|</span>
                <button onClick={() => setMakeupSelected(new Set())} style={{ fontSize: "12px", color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Keine</button>
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Test-Vorlage wählen *</label>
              <select value={makeupTemplateId} onChange={e => setMakeupTemplateId(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                <option value="">– Vorlage auswählen –</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Bearbeitungszeit (Min.)</label>
                <input type="number" min={1} max={180} value={makeupTimeLimit} onChange={e => setMakeupTimeLimit(Number(e.target.value))}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Timer-Modus</label>
                <select value={makeupTimingMode} onChange={e => setMakeupTimingMode(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                  <option value="lobby">Lobby</option>
                  <option value="countdown">Countdown ab Start</option>
                  <option value="window">Festes Zeitfenster</option>
                </select>
              </div>
            </div>

            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: "12px" }}>
              <input type="checkbox" checked={makeupAntiCheat} onChange={e => setMakeupAntiCheat(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
              🛡️ Anti-Cheat aktivieren
            </label>

            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: makeupRequireSeb ? "8px" : "24px" }}>
              <input type="checkbox" checked={makeupRequireSeb} onChange={e => setMakeupRequireSeb(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#7c3aed", marginTop: "1px", flexShrink: 0 }} />
              🔒 Safe Exam Browser erforderlich
            </label>
            {makeupRequireSeb && (
              <div style={{ marginBottom: "24px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "12px 14px", fontSize: "13px", color: "#92400e", lineHeight: 1.5 }}>
                <strong>⚠️ Hinweis:</strong> SEB ist für Android nicht verfügbar. Schüler mit Android-Geräten können die Systemtastatur mit Autokorrektur weiterhin nutzen.
              </div>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMakeupModal(false)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={createMakeupTest} disabled={!makeupTemplateId || makeupSelected.size === 0 || creatingMakeup}
                style={{ flex: 1, padding: "11px", background: (makeupTemplateId && makeupSelected.size > 0) ? "#2563a8" : "#e2e8f0", color: (makeupTemplateId && makeupSelected.size > 0) ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", fontWeight: 700, cursor: (makeupTemplateId && makeupSelected.size > 0) ? "pointer" : "not-allowed" }}>
                {creatingMakeup ? "Wird erstellt..." : `Nachtest für ${makeupSelected.size} Schüler/in aktivieren →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
