import { useState, useEffect } from "react";

const DEMO_TEST = {
  title: "Mathe – Bruchrechnung",
  timeLimit: 1200,
  questions: [
    { id: 1, type: "multiple_choice", text: "Was ergibt 1/2 + 1/2?", options: ["1/4", "1", "2", "3/4"], correct: 1, points: 2, color: "#fff3cd" },
    { id: 2, type: "multiple_choice", text: "Welcher Bruch ist größer?", options: ["1/3", "1/4", "1/5", "1/6"], correct: 0, points: 2, color: "#d4edda" },
    { id: 3, type: "open", text: "Erkläre in eigenen Worten, was der 'Nenner' eines Bruchs bedeutet.", points: 4, color: "#d1ecf1" },
    { id: 4, type: "multiple_choice", text: "Was ergibt 3/4 - 1/4?", options: ["1/2", "1/4", "2/4", "3/8"], correct: 0, points: 2, color: "#f8d7da" },
  ]
};

export default function StudentTestView({ currentUser, onFinish }) {
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(DEMO_TEST.timeLimit);
  const [submitted, setSubmitted] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (submitted) return;
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); setSubmitted(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [submitted]);

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const timePercent = (timeLeft / DEMO_TEST.timeLimit) * 100;
  const timeColor = timeLeft < 120 ? "#ef4444" : timeLeft < 300 ? "#f97316" : "#16a34a";

  const handleSubmit = () => {
    setSubmitted(true);
    setShowConfirm(false);
  };

  if (submitted) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #1e3a5f, #2563a8)",
        fontFamily: "'Segoe UI', system-ui, sans-serif"
      }}>
        <div style={{ textAlign: "center", background: "#fff", borderRadius: "24px", padding: "48px 40px", maxWidth: "400px" }}>
          <div style={{ fontSize: "64px", marginBottom: "16px" }}>✅</div>
          <h2 style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Test abgegeben!</h2>
          <p style={{ color: "#64748b", marginBottom: "24px" }}>
            Deine Antworten wurden gespeichert. Deine Lehrkraft wird das Ergebnis bald veröffentlichen.
          </p>
          <button onClick={onFinish} style={{
            padding: "12px 28px", background: "#2563a8", color: "#fff",
            border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer"
          }}>Fertig</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{
        position: "sticky", top: 0, background: "#fff",
        borderBottom: "1px solid #e2e8f0", padding: "0 24px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)", zIndex: 100
      }}>
        <div style={{ maxWidth: "700px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "16px", color: "#0f172a" }}>⚡ {DEMO_TEST.title}</div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>Angemeldet als: {currentUser?.name}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: 800, color: timeColor, fontVariantNumeric: "tabular-nums", letterSpacing: "1px" }}>
              {formatTime(timeLeft)}
            </div>
            <div style={{ height: "4px", background: "#e2e8f0", borderRadius: "4px", width: "100px", marginTop: "4px" }}>
              <div style={{ height: "4px", borderRadius: "4px", background: timeColor, width: `${timePercent}%`, transition: "width 1s linear" }} />
            </div>
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>Restzeit</div>
          </div>
          <button onClick={() => setShowConfirm(true)} style={{
            padding: "9px 18px", background: "#fef2f2", color: "#dc2626",
            border: "1px solid #fecaca", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
          }}>Test abgeben</button>
        </div>
      </div>

      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ marginBottom: "16px", display: "flex", gap: "6px" }}>
          {DEMO_TEST.questions.map((q, i) => (
            <div key={q.id} style={{
              width: "28px", height: "28px", borderRadius: "50%", display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700,
              background: answers[q.id] !== undefined ? "#2563a8" : "#e2e8f0",
              color: answers[q.id] !== undefined ? "#fff" : "#94a3b8"
            }}>{i + 1}</div>
          ))}
        </div>

        {DEMO_TEST.questions.map((q, index) => (
          <div key={q.id} style={{
            background: q.color || "#fff", borderRadius: "16px", padding: "22px",
            marginBottom: "16px", border: "2px solid rgba(0,0,0,0.06)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span style={{ background: "#0f172a", color: "#fff", borderRadius: "8px", padding: "3px 10px", fontSize: "13px", fontWeight: 700 }}>
                  {index + 1}
                </span>
                <span style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a" }}>{q.text}</span>
              </div>
              <span style={{ fontSize: "12px", color: "#94a3b8", whiteSpace: "nowrap", marginLeft: "8px" }}>{q.points} Pkt.</span>
            </div>

            {q.type === "multiple_choice" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {q.options.map((opt, i) => (
                  <button key={i} onClick={() => setAnswers(a => ({ ...a, [q.id]: i }))}
                    style={{
                      padding: "11px 14px", border: `2px solid ${answers[q.id] === i ? "#2563a8" : "rgba(0,0,0,0.12)"}`,
                      borderRadius: "10px", background: answers[q.id] === i ? "#2563a8" : "rgba(255,255,255,0.7)",
                      color: answers[q.id] === i ? "#fff" : "#374151",
                      cursor: "pointer", fontWeight: answers[q.id] === i ? 700 : 400,
                      fontSize: "14px", textAlign: "left", transition: "all 0.15s", fontFamily: "inherit"
                    }}>
                    <span style={{ marginRight: "8px", opacity: 0.7 }}>{String.fromCharCode(65 + i)}.</span>{opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === "open" && (
              <textarea
                value={answers[q.id] || ""}
                onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Deine Antwort..."
                rows={4}
                style={{
                  width: "100%", padding: "12px", border: "2px solid rgba(0,0,0,0.12)",
                  borderRadius: "10px", fontSize: "14px", resize: "vertical",
                  background: "rgba(255,255,255,0.7)", fontFamily: "inherit", boxSizing: "border-box"
                }}
              />
            )}
          </div>
        ))}

        <button onClick={() => setShowConfirm(true)} style={{
          width: "100%", padding: "14px", background: "#2563a8", color: "#fff",
          border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "15px", cursor: "pointer", marginTop: "8px"
        }}>Test abgeben</button>
      </div>

      {showConfirm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
        }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "36px", maxWidth: "380px", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤔</div>
            <h3 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Schon fertig?</h3>
            <p style={{ color: "#64748b", marginBottom: "24px", fontSize: "14px" }}>
              Bist du sicher, dass du den Test jetzt abgeben möchtest? Du kannst danach keine Antworten mehr ändern.
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setShowConfirm(false)} style={{
                flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151",
                border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer"
              }}>Zurück zum Test</button>
              <button onClick={handleSubmit} style={{
                flex: 1, padding: "11px", background: "#2563a8", color: "#fff",
                border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer"
              }}>Ja, abgeben!</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
