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
    content: "Bewerte AUSSCHLIESSLICH den inhaltlichen Kern. Groß-/Kleinschreibung ist VOLLSTÄNDIG irrelevant — 'hund' ist identisch mit 'Hund'. Rechtschreibung, Grammatik, Zeichensetzung und Tippfehler führen zu KEINEM Punktabzug. Stimmt das Wort/der Inhalt inhaltlich, gibt es volle Punktzahl.",
    standard: "Bewerte hauptsächlich den Inhalt. Nur grobe, sinnentstellende Rechtschreib- oder Grammatikfehler können minimal abgezogen werden. Kleinschreibung von Nomen oder einzelne Tippfehler führen zu keinem Abzug.",
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
- Vergleiche OHNE Rücksicht auf Groß-/Kleinschreibung: "hund" ist korrekt wenn die Musterlösung "Hund" lautet.

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


// Bewertungsmaßstab vorschlagen basierend auf echten Schülerantworten
const suggestRubricFromAnswers = async (question, submissions, supabaseUrl, supabaseAnonKey) => {
  const answers = submissions
    .filter(s => s.answers?.[question.id]?.trim())
    .map(s => s.answers[question.id]);

  if (answers.length === 0) return null;

  const prompt = `Du bist ein erfahrener Schullehrer. Du hast eine offene Frage gestellt und siehst jetzt die Antworten deiner Schüler.

Frage: ${question.text || "(Fragetext nicht verfügbar)"}
Musterlösung: ${question.solution || "(keine Musterlösung hinterlegt)"}
Maximale Punktzahl: ${question.points}

Schülerantworten (${answers.length} Antworten):
${answers.map((a, i) => `${i + 1}. "${a}"`).join("\n")}

Erstelle einen Bewertungsmaßstab der zu diesen echten Schülerantworten passt.
Die Kriterien sollen klar und nachvollziehbar sein.
Schritte von 0.5 Punkten, Summe der Kriterien = ${question.points}.

Gib das Ergebnis NUR als JSON zurück:
{
  "partialPoints": [
    {"points": <Zahl>, "description": "<konkretes Kriterium>"},
    ...
  ]
}`;

  const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
};


function RegelwerkModal({ assignmentData, currentGradingMode, customRules, applyNewGradingMode, saveCustomRules, savingRules, onClose }) {
  const [localRules, setLocalRules] = useState(customRules);
  const MODES = {
    content: { label: "🎯 Nur Inhalt", desc: "Groß-/Kleinschreibung, Rechtschreibung und Grammatik werden vollständig ignoriert. Nur der inhaltliche Kern zählt." },
    standard: { label: "⚖️ Standard", desc: "Inhalt steht im Vordergrund. Nur grobe, sinnentstellende Fehler können minimal abgezogen werden." },
    strict: { label: "🔍 Streng", desc: "Inhalt und Sprachform werden bewertet. Rechtschreibfehler, Grammatikfehler und falsche Zeichensetzung führen zu Punktabzügen." },
  };
  const mode = currentGradingMode || assignmentData?.grading_mode || "standard";
  const m = MODES[mode] || MODES.standard;

  const flattenQs = (qs) => {
    const result = [];
    for (const q of (qs || [])) {
      if (q.type === "section") { for (const t of (q.tasks||[])) for (const tq of (t.questions||[])) result.push(tq); }
      else if (q.type === "task") { for (const tq of (q.questions||[])) result.push(tq); }
      else result.push(q);
    }
    return result;
  };
  const openQs = flattenQs(assignmentData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "560px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>📋 Bewertungsregelwerk</h3>
          <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "16px", color: "#64748b" }}>✕</button>
        </div>

        <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "16px", marginBottom: "16px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px", marginBottom: "8px" }}>RECHTSCHREIBUNG & GRAMMATIK</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>{m.label}</div>
          <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "12px", lineHeight: 1.5 }}>{m.desc}</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {["content", "standard", "strict"].map(id => (
              <button key={id} onClick={() => applyNewGradingMode(id)}
                style={{ flex: 1, padding: "6px", background: id === mode ? "#eff6ff" : "#fff", border: `2px solid ${id === mode ? "#bfdbfe" : "#e2e8f0"}`, color: id === mode ? "#2563a8" : "#94a3b8", borderRadius: "6px", fontSize: "11px", fontWeight: id === mode ? 700 : 400, cursor: "pointer" }}>
                {MODES[id].label}
              </button>
            ))}
          </div>
        </div>

        {openQs.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px", marginBottom: "8px" }}>INHALTLICHE BEWERTUNG PRO AUFGABE</div>
            {openQs.map((q, i) => (
              <div key={q.id} style={{ background: "#f8fafc", borderRadius: "10px", padding: "12px 14px", marginBottom: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "4px" }}>Aufgabe {i + 1}</div>
                {q.solution && (
                  <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>
                    <span style={{ fontWeight: 600 }}>Musterlösung:</span> {q.solution}
                  </div>
                )}
                {(q.partialPoints || []).length > 0 ? (
                  <div>
                    <div style={{ fontSize: "11px", color: "#6d28d9", fontWeight: 600, marginBottom: "4px" }}>Bewertungskriterien:</div>
                    {q.partialPoints.map((p, pi) => (
                      <div key={pi} style={{ fontSize: "12px", color: "#374151", display: "flex", gap: "6px", marginBottom: "2px" }}>
                        <span style={{ background: "#eff6ff", borderRadius: "4px", padding: "1px 6px", fontWeight: 700, color: "#2563a8", flexShrink: 0 }}>{p.points} Pkt.</span>
                        <span>{p.description}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>KI bewertet nach Musterlösung ohne feste Kriterien</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px", marginBottom: "8px" }}>ZUSÄTZLICHE REGELN (für alle Aufgaben)</div>
          <textarea value={localRules} onChange={e => setLocalRules(e.target.value)} rows={4}
            placeholder={'z.B. "Antworten auf Englisch akzeptieren" oder "Abkürzungen sind erlaubt" oder "Vergangenheitsform ist auch korrekt"'}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }} />
          <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>Diese Regeln gelten bei der nächsten KI-Korrektur und alle Abgaben werden neu bewertet.</div>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Schließen</button>
          <button onClick={async () => { await saveCustomRules(localRules); onClose(); }} disabled={savingRules}
            style={{ flex: 1, padding: "11px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: savingRules ? "not-allowed" : "pointer" }}>
            {savingRules ? "⏳ Wird gespeichert..." : "✓ Speichern & neu korrigieren"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [releaseModal, setReleaseModal] = useState(false);
  const [gradingModeModal, setGradingModeModal] = useState(false);
  const [regelwerkModal, setRegelwerkModal] = useState(false);
  const [customRules, setCustomRules] = useState(""); // Zusatzregeln des Lehrers
  const [savingRules, setSavingRules] = useState(false); // vor erstem KI-Lauf
  const [gradingModeConfirmed, setGradingModeConfirmed] = useState(false); // wurde Modal bestätigt?
  const [currentGradingMode, setCurrentGradingMode] = useState(null); // wird aus assignmentData geladen // nach KI-Korrektur: Freigabe-Frage
  const [rubricModal, setRubricModal] = useState(null); // { question, suggested }
  const [rubricFeedback, setRubricFeedback] = useState(""); // Lehrer-Kommentar für KI
  const [refiningRubric, setRefiningRubric] = useState(false);
  const [questionFeedback, setQuestionFeedback] = useState({});
  const [quickPrompt, setQuickPrompt] = useState(""); // Schnell-Prompt im Detail-Panel // { qId: feedbackText }
  const [refiningQuestion, setRefiningQuestion] = useState(null); // qId being refined
  const [suggestingRubric, setSuggestingRubric] = useState(false);
  const [savingRubric, setSavingRubric] = useState(false);

  useEffect(() => {
    if (!assignment?.id) return;
    fetchAll();
    const channel = supabase
      .channel(`submissions-${assignment.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `assignment_id=eq.${assignment.id}` }, () => fetchSubmissions())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [assignment]);

  // Beim Laden: unreviewte Submissions — erst Bewertungsmodus bestätigen lassen
  useEffect(() => {
    if (!assignmentData || submissions.length === 0 || aiRunning) return;

    // Nur Abgaben die wirklich noch nicht bewertet wurden
    const pending = submissions.filter(s =>
      !s.reviewed && Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
    );
    if (pending.length === 0) return;

    // Wenn bereits andere Abgaben reviewed sind → Modus ist bereits gesetzt, einfach korrigieren
    const alreadyReviewed = submissions.some(s => s.reviewed);
    if (alreadyReviewed) {
      runAutoBatchCorrection(pending, submissions);
      return;
    }

    // Beim ersten Mal: Modal anzeigen
    if (!gradingModeConfirmed) {
      setGradingModeModal(true);
      return;
    }
    runAutoBatchCorrection(pending, submissions);
  }, [assignmentData, submissions.length, gradingModeConfirmed]);


  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchSubmissions(), fetchGroup(), fetchTemplates(), fetchAssignmentData()]);
    setLoading(false);
  };

  const fetchAssignmentData = async () => {
    const { data } = await supabase.from("assignments").select("*").eq("id", assignment.id).single();
    setAssignmentData(data);
    setCurrentGradingMode(data?.grading_mode || "standard");
    setCustomRules(data?.custom_rules || "");
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

  // Batch-Bewertung: alle Abgaben einer Frage gemeinsam und einheitlich korrigieren


  // Antwort-Normalisierung für "Nur Inhalt" Modus
  // Gleicht Groß-/Kleinschreibung der Schülerantwort an die Musterlösung an
  const normalizeAnswerCase = (answer, solution, mode) => {
    if (mode !== "content") return answer;
    if (!answer || !solution) return answer;
    // Wort für Wort vergleichen und Großschreibung aus Musterlösung übernehmen
    const answerWords = answer.trim().split(/\s+/);
    const solutionWords = solution.trim().split(/\s+/);
    const normalized = answerWords.map((word, i) => {
      const solWord = solutionWords[i] || solutionWords[solutionWords.length - 1];
      if (!solWord) return word;
      // Wenn Musterlösung-Wort großgeschrieben, Antwort-Wort auch großschreiben
      if (solWord[0] === solWord[0].toUpperCase() && solWord[0] !== solWord[0].toLowerCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word.toLowerCase();
    });
    return normalized.join(" ");
  };

  const saveGradingMode = async (mode) => {
    setCurrentGradingMode(mode);
    await supabase.from("assignments").update({ grading_mode: mode }).eq("id", assignment.id);
    setAssignmentData(prev => ({ ...prev, grading_mode: mode }));
  };

  const applyNewGradingMode = async (mode) => {
    await saveGradingMode(mode);
    // Alle Abgaben zurücksetzen und neu korrigieren
    const toReset = submissions.map(s => ({
      ...s,
      ai_corrections: Object.fromEntries(
        Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])
      ),
      reviewed: false,
    }));
    await runAutoBatchCorrection(toReset, submissions, { ...assignmentData, grading_mode: mode });
  };


  const saveCustomRules = async (rules) => {
    setSavingRules(true);
    setCustomRules(rules);
    await supabase.from("assignments").update({ custom_rules: rules }).eq("id", assignment.id);
    setAssignmentData(prev => ({ ...prev, custom_rules: rules }));
    setSavingRules(false);
    // Neu korrigieren mit neuen Regeln
    if (rules !== (assignmentData?.custom_rules || "")) {
      const toReset = submissions.map(s => ({
        ...s,
        ai_corrections: Object.fromEntries(
          Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])
        ),
        reviewed: false,
      }));
      await runAutoBatchCorrection(toReset, submissions, { ...assignmentData, custom_rules: rules });
    }
  };

  const runAutoBatchCorrection = async (pendingOverride = null, allSubsSnapshot = null, aDataOverride = null) => {
    const pending = pendingOverride || submissions.filter(s =>
      !s.reviewed && Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
    );
    if (pending.length === 0) return;
    const aData = aDataOverride || assignmentData;
    setAiRunning(true);
    setAiProgress(`🤖 KI bewertet ${pending.length} Abgabe${pending.length !== 1 ? "n" : ""} einheitlich...`);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const allSubs = allSubsSnapshot || submissions;

      // Fragen flachklopfen (sections + tasks)
      const flattenQs = (qs) => {
        const result = [];
        for (const q of qs) {
          if (q.type === "section") { for (const t of (q.tasks||[])) for (const tq of (t.questions||[])) result.push(tq); }
          else if (q.type === "task") { for (const tq of (q.questions||[])) result.push(tq); }
          else result.push(q);
        }
        return result;
      };
      const openQs = flattenQs(aData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");
      if (openQs.length === 0) { setAiRunning(false); setAiProgress(""); return; }

      const gradingModeText = {
        content: "Bewerte AUSSCHLIESSLICH den inhaltlichen Kern. Groß-/Kleinschreibung ist VOLLSTÄNDIG irrelevant — 'hund' ist identisch mit 'Hund'. Rechtschreibung, Grammatik, Zeichensetzung und Tippfehler führen zu KEINEM Punktabzug. Stimmt das Wort/der Inhalt inhaltlich, gibt es volle Punktzahl.",
        standard: "Bewerte primär den Inhalt. Grobe Fehler können leicht abgezogen werden.",
        strict: "Bewerte Inhalt UND Sprachform. Fehler führen zu Punktabzügen.",
      }[aData?.grading_mode || "standard"] || "";

      const batchResults = {};

      const isContentOnly = (aData?.grading_mode || "standard") === "content";

      for (const q of openQs) {
        // Bei "Nur Inhalt": alles lowercase damit Claude keine Großschreibung bemängeln kann
        const normalizeText = (t) => isContentOnly ? (t || "").toLowerCase() : (t || "");
        const answers = pending.filter(s => s.answers?.[q.id]?.trim()).map(s => ({
          id: s.id,
          username: s.username,
          answer: normalizeText(s.answers[q.id]),
          originalAnswer: s.answers[q.id],
        }));
        if (answers.length === 0) continue;
        const normalizedSolution = normalizeText(q.solution);

        const calibrationRefs = allSubs.filter(s => s.reviewed && s.ai_corrections?.[q.id]?.aiReviewed && !pending.find(p => p.id === s.id))
          .slice(0, 4)
          .map(s => `- "${s.answers[q.id]}" → ${s.ai_corrections[q.id].points} Pkt. (${(s.ai_corrections[q.id].comment || "").replace("🤖 ", "")})`)
          .join("\n");

        const customRulesText = aData?.custom_rules ? `
Zusätzliche Regeln der Lehrkraft (verbindlich):
${aData.custom_rules}
` : "";
        const prompt = `Du bist ein Schullehrer und bewertest ALLE Schülerantworten auf dieselbe Frage GLEICHZEITIG und EINHEITLICH.

Frage: ${q.text || "(Fragetext)"}
Musterlösung: ${isContentOnly ? normalizedSolution || "(keine Musterlösung)" : (q.solution || "(keine Musterlösung)")}
Maximale Punktzahl: ${q.points}
Bewertungsregeln: ${gradingModeText}
${customRulesText}
GRUNDREGEL — IMMER GÜLTIG (unabhängig vom Bewertungsmodus):
- Vergleiche Antworten OHNE Rücksicht auf Groß-/Kleinschreibung: "hund" = "Hund" = "HUND"
- Wenn der inhaltliche Kern stimmt, zählt die Antwort als korrekt

${(q.partialPoints || []).length > 0
  ? `Bewertungskriterien (verbindlich — halte dich EXAKT daran):
${q.partialPoints.map(p => `- ${p.points} Punkt${Number(p.points) !== 1 ? "e" : ""} für: ${p.description}`).join("\n")}`
  : `- Vergib anteilige Punkte wenn die Antwort teilweise korrekt ist\n- Schritte von 0.5 Punkten möglich`}

${calibrationRefs ? `Referenz-Bewertungen (bereits kalibriert):\n${calibrationRefs}\n` : ""}
Schülerantworten:
${answers.map((a, i) => `Schüler ${i + 1} (${a.username}): "${a.answer}"`).join("\n")}

Gib deine Bewertung als JSON zurück mit zwei Feldern:
{
  "criteria": "<Beschreibe in 1-2 Sätzen welche inhaltlichen Maßstäbe du angewendet hast, z.B. welche Antworten akzeptiert werden>",
  "results": [{"username": "<name>", "points": <Zahl, max ${q.points}>, "comment": "<kurze Begründung, max 1 Satz>"}]
}`;

        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
            body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
          });
          const data = await response.json();
          const text = data.content?.map(b => b.text || "").join("") || "";
          let parsed, results, usedCriteria;
          try {
            parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
            // Handle both {criteria, results} and plain array formats
            if (Array.isArray(parsed)) {
              results = parsed;
              usedCriteria = null;
            } else {
              results = parsed.results || [];
              usedCriteria = parsed.criteria || null;
            }
          } catch (e) {
            console.error("Parse error:", e, text.slice(0, 200));
            continue;
          }
          (Array.isArray(results) ? results : []).forEach((r, i) => {
            const sub = answers[i];
            if (!sub) return;
            if (!batchResults[sub.id]) batchResults[sub.id] = {};
            batchResults[sub.id][q.id] = {
              points: Math.min(Math.max(0, Number(r.points) || 0), Number(q.points)),
              comment: `🤖 ${r.comment}`,
              usedCriteria,
              aiReviewed: true, needsReview: false,
              correct: Number(r.points) >= Number(q.points),
              maxPoints: Number(q.points),
            };
          });
        } catch (e) { console.error("Batch error for question", q.id, e); }
      }

      // In DB speichern
      for (const s of pending) {
        const newCorrections = batchResults[s.id] || {};
        const merged = { ...(s.ai_corrections || {}), ...newCorrections };
        // Fehlende offene Fragen als 0 markieren — nur wenn wirklich keine Antwort
        for (const q of openQs) {
          const qIdStr = String(q.id);
          const hasAnswer = pending.find(p => p.id === s.id)?.answers?.[q.id]?.trim() ||
                           pending.find(p => p.id === s.id)?.answers?.[qIdStr]?.trim();
          const alreadyMerged = merged[q.id] || merged[qIdStr];
          if (!alreadyMerged || (alreadyMerged.needsReview && !alreadyMerged.aiReviewed)) {
            if (!hasAnswer) {
              merged[qIdStr] = { points: 0, correct: false, comment: "Keine Antwort gegeben.", aiReviewed: true, needsReview: false, maxPoints: Number(q.points) };
            }
          }
        }
        let newScore = 0;
        for (const [qId, correction] of Object.entries(merged)) {
          const ov = (s.manual_overrides || {})[qId];
          newScore += ov !== undefined ? Number(ov) : (correction.points ?? 0);
        }
        const percent = (newScore / (s.total_points || 1)) * 100;
        const gs = [...(aData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
        let newGrade = "6";
        for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
        await supabase.from("submissions").update({ ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true }).eq("id", s.id);
        setSubmissions(prev => prev.map(sub => sub.id === s.id ? { ...sub, ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true } : sub));
        if (selectedSubmission?.id === s.id) setSelectedSubmission(prev => ({ ...prev, ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true }));
      }
      setAiProgress("✅ KI-Korrektur abgeschlossen!");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); setReleaseModal(true); }, 3000);
    } catch (e) {
      setAiProgress("❌ Fehler bei der KI-Korrektur.");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); }, 3000);
    }
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


  const handleSuggestRubric = async (question) => {
    setSuggestingRubric(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const result = await suggestRubricFromAnswers(question, submissions, supabaseUrl, supabaseAnonKey);
      if (result?.partialPoints?.length) {
        setRubricModal({ question, suggested: result.partialPoints });
      }
    } catch (e) {
      console.error("Rubric suggestion failed:", e);
    }
    setSuggestingRubric(false);
  };




  const applyQuickPrompt = async (promptText) => {
    if (!promptText.trim() || !selectedSubmission) return;
    setRefiningQuestion("all");
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const aData = assignmentData;

      const flattenQs = (qs) => {
        const result = [];
        for (const q of (qs || [])) {
          if (q.type === "section") { for (const t of (q.tasks||[])) for (const tq of (t.questions||[])) result.push(tq); }
          else if (q.type === "task") { for (const tq of (q.questions||[])) result.push(tq); }
          else result.push(q);
        }
        return result;
      };
      const openQs = flattenQs(aData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");
      const corrections = selectedSubmission.ai_corrections || {};
      const gradingModeText = {
        content: "Groß-/Kleinschreibung und Rechtschreibung vollständig ignorieren.",
        standard: "Inhalt hauptsächlich bewerten, grobe Fehler minimal abziehen.",
        strict: "Inhalt und Sprachform streng bewerten.",
      }[aData?.grading_mode || "standard"] || "";

      // Alle offenen Fragen dieser Abgabe neu bewerten mit dem Prompt
      const answersBlock = openQs.map(q => {
        const ans = selectedSubmission.answers?.[q.id] || "(keine Antwort)";
        const corr = corrections[q.id];
        return `Frage: ${q.text || "(Fragetext)"}
Musterlösung: ${q.solution || "(keine)"}
Antwort: ${ans}
Aktuelle Bewertung: ${corr?.points ?? "–"}/${q.points} Pkt. — ${corr?.comment || ""}`;
      }).join("

");

      const prompt = `Du bist ein Schullehrer und überarbeitest deine Korrekturen für einen Schüler.

${answersBlock}

Bewertungsregeln: ${gradingModeText}
${aData?.custom_rules ? `Zusatzregeln: ${aData.custom_rules}` : ""}

Anweisung des Lehrers: ${promptText}

Bewerte alle Fragen neu und gib das Ergebnis als JSON-Array zurück:
[{"qId": "<id>", "points": <Zahl>, "comment": "<Begründung>"}]

Die IDs der Fragen sind: ${openQs.map(q => q.id).join(", ")}`;

      const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

      const newCorrections = { ...corrections };
      let newScore = 0;
      for (const r of parsed) {
        const q = openQs.find(q => String(q.id) === String(r.qId));
        if (!q) continue;
        newCorrections[r.qId] = {
          ...(corrections[r.qId] || {}),
          points: Math.min(Math.max(0, Number(r.points)), Number(q.points)),
          comment: `🤖 ${r.comment}`,
          aiReviewed: true, needsReview: false,
          correct: Number(r.points) >= Number(q.points),
          maxPoints: Number(q.points),
        };
      }
      for (const [qId, c] of Object.entries(newCorrections)) {
        const ov = (selectedSubmission.manual_overrides || {})[qId];
        newScore += ov !== undefined ? Number(ov) : (c.points ?? 0);
      }
      const percent = (newScore / (selectedSubmission.total_points || 1)) * 100;
      const gs = [...(aData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
      let newGrade = "6";
      for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }

      await supabase.from("submissions").update({ ai_corrections: newCorrections, score: newScore, grade: newGrade, reviewed: true }).eq("id", selectedSubmission.id);
      const updated = { ...selectedSubmission, ai_corrections: newCorrections, score: newScore, grade: newGrade };
      setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? updated : s));
      setSelectedSubmission(updated);
      setQuickPrompt("");
    } catch (e) { console.error("Quick prompt failed:", e); }
    setRefiningQuestion(null);
  };

  const refineQuestionWithFeedback = async (qId, feedbackText) => {
    setRefiningQuestion(qId);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Frage aus assignmentData holen
      const flattenQs = (qs) => {
        const result = [];
        for (const q of (qs || [])) {
          if (q.type === "section") { for (const t of (q.tasks||[])) for (const tq of (t.questions||[])) result.push(tq); }
          else if (q.type === "task") { for (const tq of (q.questions||[])) result.push(tq); }
          else result.push(q);
        }
        return result;
      };
      const question = flattenQs(assignmentData?.question_data || []).find(q => String(q.id) === String(qId));
      if (!question) return;

      const answers = submissions.filter(s => s.answers?.[qId]?.trim()).map(s => s.answers[qId]);
      const currentCorrections = submissions.map(s => s.ai_corrections?.[qId]).filter(Boolean);
      const currentCriteria = (question.partialPoints || []).map(p => `- ${p.points} Pkt.: ${p.description}`).join("\n");
      const exampleCorrections = submissions.filter(s => s.ai_corrections?.[qId]?.aiReviewed).slice(0, 3)
        .map(s => `"${s.answers?.[qId]}" → ${s.ai_corrections[qId].points} Pkt. (${s.ai_corrections[qId].comment?.replace("🤖 ", "")})`).join("\n");

      const prompt = `Du bist ein Schullehrer und überarbeitest einen Bewertungsmaßstab basierend auf dem Feedback der Lehrkraft.

Frage: ${question.text || "(Fragetext)"}
Musterlösung: ${question.solution || "(keine)"}
Maximale Punktzahl: ${question.points}

${currentCriteria ? `Aktueller Bewertungsmaßstab:
${currentCriteria}
` : ""}
${exampleCorrections ? `Beispiel-Korrekturen bisher:
${exampleCorrections}
` : ""}
Schülerantworten: ${answers.map((a, i) => `${i+1}. "${a}"`).join(", ")}

Feedback der Lehrkraft: ${feedbackText}

Passe den Bewertungsmaßstab entsprechend dem Feedback an. Die Summe muss exakt ${question.points} Punkte ergeben.
Gib das Ergebnis NUR als JSON zurück:
{"partialPoints": [{"points": <Zahl>, "description": "<Kriterium>"}]}`;

      const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const result = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (!result?.partialPoints?.length) return;

      // Maßstab in Template + Assignment speichern
      const updateQd = (qs) => (qs || []).map(q => {
        if (String(q.id) === String(qId)) return { ...q, partialPoints: result.partialPoints };
        if (q.tasks) return { ...q, tasks: q.tasks.map(t => ({ ...t, questions: (t.questions||[]).map(tq => String(tq.id) === String(qId) ? { ...tq, partialPoints: result.partialPoints } : tq) })) };
        if (q.questions) return { ...q, questions: updateQd(q.questions) };
        return q;
      });

      if (assignmentData?.template_id) {
        const { data: tmpl } = await supabase.from("templates").select("question_data").eq("id", assignmentData.template_id).single();
        if (tmpl) await supabase.from("templates").update({ question_data: updateQd(tmpl.question_data) }).eq("id", assignmentData.template_id);
      }
      const updatedAsgn = updateQd(assignmentData?.question_data || []);
      await supabase.from("assignments").update({ question_data: updatedAsgn }).eq("id", assignmentData.id);
      const updatedAssignmentData = { ...assignmentData, question_data: updatedAsgn };
      setAssignmentData(updatedAssignmentData);

      // Feedback leeren
      setQuestionFeedback(prev => ({ ...prev, [qId]: "" }));

      // Alle Abgaben neu korrigieren mit neuem Maßstab
      const toReCorrect = submissions.map(s => ({
        ...s,
        ai_corrections: Object.fromEntries(Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])),
        reviewed: false,
      }));
      await runAutoBatchCorrection(toReCorrect, submissions, updatedAssignmentData);
    } catch (e) { console.error("Refine question failed:", e); }
    setRefiningQuestion(null);
  };

  const refineRubricWithFeedback = async () => {
    if (!rubricModal || !rubricFeedback.trim()) return;
    setRefiningRubric(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const answers = submissions
        .filter(s => s.answers?.[rubricModal.question.id]?.trim())
        .map(s => s.answers[rubricModal.question.id]);

      const currentCriteria = rubricModal.suggested
        .map(p => `- ${p.points} Pkt.: ${p.description}`)
        .join("\n");

      const prompt = `Du bist ein Schullehrer und überarbeitest einen Bewertungsmaßstab basierend auf dem Feedback der Lehrkraft.

Frage: ${rubricModal.question.text || "(Fragetext)"}
Musterlösung: ${rubricModal.question.solution || "(keine)"}
Maximale Punktzahl: ${rubricModal.question.points}

Aktueller Bewertungsmaßstab:
${currentCriteria}

Schülerantworten:
${answers.map((a, i) => `${i + 1}. "${a}"`).join("\n")}

Feedback der Lehrkraft: ${rubricFeedback}

Passe den Bewertungsmaßstab entsprechend dem Feedback an. Die Summe der Punkte muss exakt ${rubricModal.question.points} ergeben.

Gib das Ergebnis NUR als JSON zurück:
{"partialPoints": [{"points": <Zahl>, "description": "<Kriterium>"}]}`;

      const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const result = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (result?.partialPoints?.length) {
        setRubricModal(prev => ({ ...prev, suggested: result.partialPoints }));
        setRubricFeedback("");
      }
    } catch (e) { console.error("Refine rubric failed:", e); }
    setRefiningRubric(false);
  };

  const saveRubricToTemplate = async () => {
    if (!rubricModal || !assignmentData?.template_id) return;
    setSavingRubric(true);
    try {
      // Template laden
      const { data: template } = await supabase.from("templates").select("question_data").eq("id", assignmentData.template_id).single();
      if (!template) return;

      // Frage in template finden und partialPoints setzen
      const updateQuestionData = (qs) => qs.map(q => {
        if (String(q.id) === String(rubricModal.question.id)) {
          return { ...q, partialPoints: rubricModal.suggested };
        }
        // Auch in tasks/sections suchen
        if (q.tasks) return { ...q, tasks: q.tasks.map(t => ({ ...t, questions: (t.questions || []).map(tq => String(tq.id) === String(rubricModal.question.id) ? { ...tq, partialPoints: rubricModal.suggested } : tq) })) };
        if (q.questions) return { ...q, questions: updateQuestionData(q.questions) };
        return q;
      });

      const updatedQd = updateQuestionData(template.question_data || []);
      await supabase.from("templates").update({ question_data: updatedQd }).eq("id", assignmentData.template_id);

      // Auch assignments question_data updaten damit aktuelle KI-Korrekturen den Maßstab kennen
      const updatedAsgn = updateQuestionData(assignmentData.question_data || []);
      await supabase.from("assignments").update({ question_data: updatedAsgn }).eq("id", assignmentData.id);
      const updatedAssignmentData = { ...assignmentData, question_data: updatedAsgn };
      setAssignmentData(updatedAssignmentData);

      setRubricModal(null);
      setSavingRubric(false);

      // Alle Abgaben mit dem neuen Maßstab neu korrigieren
      const toReCorrect = submissions.filter(s =>
        Object.values(s.ai_corrections || {}).some(c => c.aiReviewed) ||
        Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
      );
      if (toReCorrect.length > 0) {
        // ai_corrections zurücksetzen damit Batch neu bewertet
        const resetSubs = toReCorrect.map(s => ({
          ...s,
          ai_corrections: Object.fromEntries(
            Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])
          ),
          reviewed: false,
        }));
        await runAutoBatchCorrection(resetSubs, [...submissions, ...resetSubs]);
      }
      return;
    } catch (e) {
      console.error("Save rubric failed:", e);
    }
    setSavingRubric(false);
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
    setSelectedSubmission(null);
  };

  // Freigabe-Funktionen
  const releaseSubmissions = async (ids) => {
    await Promise.all(ids.map(id =>
      supabase.from("submissions").update({ released: true }).eq("id", id)
    ));
    setSubmissions(prev => prev.map(s => ids.includes(s.id) ? { ...s, released: true } : s));
    if (selectedSubmission && ids.includes(selectedSubmission.id)) {
      setSelectedSubmission(prev => ({ ...prev, released: true }));
    }
  };

  const releaseAll = () => releaseSubmissions(submissions.map(s => s.id));

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
            <button onClick={() => setRegelwerkModal(true)} style={{ marginLeft: "12px", padding: "4px 12px", background: "#f5f3ff", color: "#6d28d9", border: "1px solid #e9d5ff", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>📋 Regelwerk</button>
            {submissions.some(s => !s.released) && (
              <button onClick={releaseAll} style={{ marginLeft: "12px", padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>✓ Alle freigeben</button>
            )}
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
                <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Schüler/in", "Punkte", "Note", "Status", "Freigabe", ""].map(h => (
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
                              {s.released ? (
                                <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Freigegeben</span>
                              ) : (
                                <button onClick={() => releaseSubmissions([s.id])} style={{ padding: "4px 10px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Freigeben</button>
                              )}
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
                  <div onClick={() => setSelectedSubmission(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 499 }} />
                )}
                {selectedSubmission && (
                  <div style={{ position: "fixed", top: 0, right: 0, width: "480px", height: "100vh", background: "#fff", borderLeft: "1px solid #e2e8f0", padding: "24px", overflowY: "auto", zIndex: 500, boxShadow: "-4px 0 24px rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>{selectedSubmission.username}</h3>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button onClick={() => setSelectedSubmission(null)} style={{ background: "#f1f5f9", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "16px", color: "#64748b", lineHeight: 1 }}>✕</button>
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
                    <p style={{ margin: "0 0 10px", color: "#64748b", fontSize: "13px" }}>
                      Abgegeben: {new Date(selectedSubmission.submitted_at).toLocaleString("de-DE")}
                    </p>
                    {/* Schnell-Prompt für alle Aufgaben */}
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px", marginBottom: "14px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "6px" }}>KORREKTUR VERFEINERN (alle Aufgaben)</div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input value={quickPrompt} onChange={e => setQuickPrompt(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && quickPrompt.trim()) applyQuickPrompt(quickPrompt); }}
                          placeholder='z.B. "Sei kulanter bei Vokabeln" oder "Grundform zählt auch"'
                          style={{ flex: 1, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit" }} />
                        <button onClick={() => applyQuickPrompt(quickPrompt)} disabled={!quickPrompt.trim() || refiningQuestion === "all"}
                          style={{ padding: "6px 10px", background: quickPrompt.trim() ? "#2563a8" : "#e2e8f0", color: quickPrompt.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: quickPrompt.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>
                          {refiningQuestion === "all" ? "⏳" : "↩ Anwenden"}
                        </button>
                      </div>
                    </div>

                  {/* Bewertungsmodus-Anzeige oben im Panel */}
                  {(() => {
                    const mode = currentGradingMode || assignmentData?.grading_mode || "standard";
                    const MODES = {
                      content: { label: "🎯 Nur Inhalt", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
                      standard: { label: "⚖️ Standard", color: "#2563a8", bg: "#eff6ff", border: "#bfdbfe" },
                      strict: { label: "🔍 Streng", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
                    };
                    const m = MODES[mode] || MODES.standard;
                    return (
                      <div style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: "8px", padding: "10px 14px", marginBottom: "14px" }}>
                        <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 600, marginBottom: "6px" }}>RECHTSCHREIBUNG & GRAMMATIK</div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {["content", "standard", "strict"].map(id => (
                            <button key={id} onClick={() => applyNewGradingMode(id)} disabled={aiRunning}
                              style={{ flex: 1, padding: "6px 4px", background: id === mode ? MODES[id].bg : "#fff", border: `2px solid ${id === mode ? MODES[id].border : "#e2e8f0"}`, color: id === mode ? MODES[id].color : "#94a3b8", borderRadius: "6px", fontSize: "11px", fontWeight: id === mode ? 700 : 500, cursor: aiRunning ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                              {MODES[id].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                    {/* Meta-Infos für Ausdruck */}
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 16px", marginBottom: "18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "13px" }}>
                      <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>SCHÜLER/IN</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{selectedSubmission.username}</span></div>
                      <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>DATUM</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{new Date(selectedSubmission.submitted_at).toLocaleDateString("de-DE")}</span></div>
                      <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "2px" }}>LEHRKRAFT</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{currentUser?.name || "–"}</span></div>
                    </div>

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
                          } else if (q.type === "task") {
                            for (const tq of (q.questions || [])) flat.push(tq);
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
                            <em style={{ color: "#94a3b8" }}>Antwort:</em> {(() => {
                              const ans = selectedSubmission.answers?.[qId];
                              if (!ans) return "–";
                              if (Array.isArray(ans)) return ans.join(", ");
                              return ans;
                            })()}
                          </div>
                          {correction.comment && (
                            <div style={{ background: isStillOpen ? "#fef9c3" : isAiReviewed ? "#eff6ff" : correction.correct ? "#dcfce7" : "#fef2f2", borderRadius: "8px", padding: "8px 10px", marginBottom: "6px", fontSize: "12px", color: isStillOpen ? "#92400e" : isAiReviewed ? "#1e40af" : correction.correct ? "#16a34a" : "#dc2626" }}>
                              {correction.comment}
                            </div>
                          )}
                          {correction.usedCriteria && (
                            <div style={{ background: "#f8fafc", borderRadius: "6px", padding: "6px 10px", marginBottom: "8px", fontSize: "11px", color: "#64748b", border: "1px solid #e2e8f0" }}>
                              <span style={{ fontWeight: 600, color: "#94a3b8" }}>📐 Angewendete Kriterien: </span>{correction.usedCriteria}
                            </div>
                          )}
                          {correction.solution && (
                            <div style={{ background: "#f0f7ff", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px", fontSize: "12px", color: "#1e3a5f", border: "1px solid #bfdbfe" }}>
                              <strong>📝 Musterlösung:</strong> {correction.solution}
                            </div>
                          )}
                          {/* Feedback für KI-Maßstab */}
                          {isAiReviewed && (
                            <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px" }}>
                              <div style={{ fontSize: "11px", fontWeight: 600, color: "#6d28d9", marginBottom: "5px" }}>💬 KI-Maßstab anpassen</div>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <input
                                  value={questionFeedback[qId] || ""}
                                  onChange={e => setQuestionFeedback(prev => ({ ...prev, [qId]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === "Enter" && questionFeedback[qId]?.trim()) refineQuestionWithFeedback(qId, questionFeedback[qId]); }}
                                  placeholder='z.B. "zu streng" oder "Grundform reicht ohne to"'
                                  style={{ flex: 1, padding: "5px 8px", border: "1px solid #e9d5ff", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", background: "#fff" }}
                                />
                                <button
                                  onClick={() => refineQuestionWithFeedback(qId, questionFeedback[qId])}
                                  disabled={!questionFeedback[qId]?.trim() || refiningQuestion === qId}
                                  style={{ padding: "5px 10px", background: questionFeedback[qId]?.trim() ? "#6d28d9" : "#e2e8f0", color: questionFeedback[qId]?.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: questionFeedback[qId]?.trim() && refiningQuestion !== qId ? "pointer" : "not-allowed", flexShrink: 0, whiteSpace: "nowrap" }}>
                                  {refiningQuestion === qId ? "⏳ läuft..." : "↩ Anpassen"}
                                </button>
                              </div>
                              {refiningQuestion === qId && (
                                <div style={{ fontSize: "11px", color: "#6d28d9", marginTop: "4px" }}>KI überarbeitet Maßstab und korrigiert alle Abgaben neu...</div>
                              )}
                            </div>
                          )}
                          {correction.aiReviewed && !correction.partialPoints?.length && (() => {
                            const q = (assignmentData?.question_data || []).flatMap(q => q.type === "section" ? (q.tasks || []).flatMap(t => t.questions || []) : q.tasks ? (q.tasks || []).flatMap(t => t.questions || []) : [q]).find(q => String(q.id) === qId);
                            if (!q || (q.partialPoints?.length > 0)) return null;
                            return (
                              <button onClick={() => handleSuggestRubric({ ...q, id: qId })} disabled={suggestingRubric}
                                style={{ marginBottom: "8px", padding: "5px 10px", background: "#f5f3ff", color: "#6d28d9", border: "1px solid #e9d5ff", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: suggestingRubric ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "4px" }}>
                                {suggestingRubric ? "⏳ KI analysiert..." : "🎯 Bewertungsmaßstab vorschlagen"}
                              </button>
                            );
                          })()}
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

                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <button onClick={saveOverrides} disabled={saving} style={{ flex: 1, padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: saving ? "not-allowed" : "pointer" }}>
                        {saving ? "Wird gespeichert..." : "✓ Korrekturen speichern"}
                      </button>
                      <button onClick={() => setSelectedSubmission(null)} style={{ padding: "10px 16px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                        Schließen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>


      {/* REGELWERK MODAL */}
      {regelwerkModal && assignmentData && (
        <RegelwerkModal
          assignmentData={assignmentData}
          currentGradingMode={currentGradingMode}
          customRules={customRules}
          applyNewGradingMode={applyNewGradingMode}
          saveCustomRules={saveCustomRules}
          savingRules={savingRules}
          onClose={() => setRegelwerkModal(false)}
        />
      )}

      {/* BEWERTUNGSMODUS-MODAL vor KI-Korrektur */}
      {gradingModeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "440px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Wie soll die KI Rechtschreibung & Grammatik bewerten?</h3>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px", lineHeight: 1.6 }}>
              Wähle wie streng Rechtschreibung und Grammatik bewertet werden. Du kannst den Modus später jederzeit in den Korrekturdetails ändern.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "8px" }}>
              {[
                { id: "content", label: "🎯 Nur Inhalt", desc: "Rechtschreibung & Grammatik werden ignoriert — nur der inhaltliche Kern zählt", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
                { id: "standard", label: "⚖️ Standard", desc: "Inhalt zählt hauptsächlich, grobe Fehler können leicht abgezogen werden", color: "#2563a8", bg: "#eff6ff", border: "#bfdbfe" },
                { id: "strict", label: "🔍 Streng", desc: "Inhalt + Rechtschreibung + Grammatik + Zeichensetzung werden bewertet", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
              ].map(mode => (
                <button key={mode.id} onClick={async () => {
                  setGradingModeModal(false);
                  setGradingModeConfirmed(true);
                  await saveGradingMode(mode.id);
                  const pending = submissions.filter(s =>
                    !s.reviewed && Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
                  );
                  runAutoBatchCorrection(pending, submissions, { ...assignmentData, grading_mode: mode.id });
                }}
                  style={{ padding: "14px 16px", background: mode.bg, border: `2px solid ${mode.border}`, borderRadius: "12px", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: mode.color, marginBottom: "4px" }}>{mode.label}</div>
                  <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.4 }}>{mode.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FREIGABE-MODAL nach KI-Korrektur */}
      {releaseModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "400px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖✅</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>KI-Korrektur abgeschlossen</h3>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px", lineHeight: 1.6 }}>
              Möchtest du die Korrekturen jetzt für alle Schüler freigeben? Sie können dann ihre Bewertung einsehen.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => { releaseAll(); setReleaseModal(false); }} style={{ padding: "12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
                ✓ Ja, alle Korrekturen freigeben
              </button>
              <button onClick={() => setReleaseModal(false)} style={{ padding: "12px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>
                Nein, ich schaue zuerst drüber
              </button>
            </div>
          </div>
        </div>
      )}

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
      {/* BEWERTUNGSMASSTAB MODAL */}
      {rubricModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "480px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "12px" }}>🎯</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 6px", color: "#0f172a", textAlign: "center" }}>KI schlägt Bewertungsmaßstab vor</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "20px", textAlign: "center", lineHeight: 1.5 }}>
              Basierend auf den echten Schülerantworten. Wird in der Vorlage gespeichert und bei künftigen Tests wiederverwendet.
            </p>
            <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "16px", marginBottom: "20px", border: "1px solid #e2e8f0" }}>
              {rubricModal.suggested.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <div style={{ background: "#6d28d9", color: "#fff", borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{p.points} Pkt.</div>
                  <input value={p.description} onChange={e => setRubricModal(prev => ({ ...prev, suggested: prev.suggested.map((pp, pi) => pi === i ? { ...pp, description: e.target.value } : pp) }))}
                    style={{ flex: 1, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: "inherit" }} />
                  <input type="number" value={p.points} min={0} step={0.5} onChange={e => setRubricModal(prev => ({ ...prev, suggested: prev.suggested.map((pp, pi) => pi === i ? { ...pp, points: Number(e.target.value) } : pp) }))}
                    style={{ width: "54px", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", textAlign: "center" }} />
                </div>
              ))}
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "8px", textAlign: "right" }}>
                Summe: <strong style={{ color: rubricModal.suggested.reduce((s, p) => s + Number(p.points), 0) === Number(rubricModal.question.points) ? "#16a34a" : "#dc2626" }}>
                  {rubricModal.suggested.reduce((s, p) => s + Number(p.points), 0)} / {rubricModal.question.points} Pkt.
                </strong>
              </div>
            </div>
            {/* Feedback-Box für KI-Überarbeitung */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>
                💬 Feedback an KI (optional) — KI überarbeitet die Kriterien
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input value={rubricFeedback} onChange={e => setRubricFeedback(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && rubricFeedback.trim()) refineRubricWithFeedback(); }}
                  placeholder='z.B. "zu streng" oder "Grundform reicht ohne to"'
                  style={{ flex: 1, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", fontFamily: "inherit" }} />
                <button onClick={refineRubricWithFeedback} disabled={!rubricFeedback.trim() || refiningRubric}
                  style={{ padding: "8px 14px", background: rubricFeedback.trim() ? "#6d28d9" : "#e2e8f0", color: rubricFeedback.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: rubricFeedback.trim() && !refiningRubric ? "pointer" : "not-allowed", flexShrink: 0 }}>
                  {refiningRubric ? "⏳" : "↩ Anpassen"}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setRubricModal(null); setRubricFeedback(""); }} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={saveRubricToTemplate} disabled={savingRubric}
                style={{ flex: 1, padding: "11px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: savingRubric ? "not-allowed" : "pointer" }}>
                {savingRubric ? "Wird gespeichert..." : "✓ In Vorlage speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
