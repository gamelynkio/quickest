import { useState, useEffect, useRef } from "react";

const STEPS = [
  {
    page: "groups",
    title: "1. Lerngruppe anlegen",
    text: "Lege hier eine Klasse an. QuickTest generiert anonyme Tiernamen als Benutzernamen. Drucke die Liste aus, schreibe die echten Schülernamen handschriftlich dazu und teile die Zugangskarten aus.",
    anchor: "nav-groups",
    arrow: "left",
  },
  {
    page: "testEditor",
    title: "2. Test erstellen",
    text: "Erstelle einen neuen Test mit Abschnitten und Aufgaben — oder lade eine Vorlage aus der Bibliothek. Du kannst auch bestehende Tests als Datei importieren.",
    anchor: "nav-testEditor",
    arrow: "left",
  },
  {
    page: "library",
    title: "2b. Test zuweisen",
    text: "In der Vorlagen-Bibliothek kannst du fertige Tests einer Klasse zuweisen. Wähle Zeitlimit und Startmodus (Lobby, Countdown oder Zeitfenster).",
    anchor: "nav-library",
    arrow: "left",
  },
  {
    page: "dashboard",
    title: "3. Test starten & überwachen",
    text: "Im Dashboard siehst du alle aktiven Tests. Bei Lobby-Tests startest du den Test gemeinsam für alle Schüler. Du kannst Tests pausieren oder vorzeitig beenden.",
    anchor: "nav-dashboard",
    arrow: "left",
  },
  {
    page: "dashboard",
    title: "4. KI-Korrektur & manuelle Nachbesserung",
    text: "Nach dem Test korrigiert die KI alle offenen Antworten automatisch — einheitlich für alle Schüler. Du kannst Bewertungen im Detail anpassen bevor du sie freigibst.",
    anchor: "results-hint",
    arrow: "bottom",
    centered: true,
  },
  {
    page: "dashboard",
    title: "5. Ergebnisse freigeben",
    text: "Erst wenn du freigibst, sehen Schüler ihre Note und die Korrektur im Detail. So hast du Zeit alles in Ruhe zu prüfen.",
    anchor: "release-hint",
    arrow: "bottom",
    centered: true,
  },
];

export default function OnboardingTour({ userId, navigate, currentPage }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const tourRef = useRef(null);

  // Check if tour was already dismissed
  useEffect(() => {
    if (!userId) return;
    const key = `qt_tour_done_${userId}`;
    const done = localStorage.getItem(key);
    if (!done) {
      setTimeout(() => setVisible(true), 800);
    }
  }, [userId]);

  const dismiss = () => {
    setVisible(false);
    if (userId) localStorage.setItem(`qt_tour_done_${userId}`, "1");
  };

  const currentStep = STEPS[step];

  // Navigate to correct page when step changes
  useEffect(() => {
    if (!visible) return;
    if (currentStep?.page && currentStep.page !== currentPage) {
      navigate(currentStep.page);
    }
  }, [step, visible]);

  // Position tooltip next to anchor element
  useEffect(() => {
    if (!visible || currentStep?.centered) return;
    const tryPosition = () => {
      const anchor = document.querySelector(`[data-tour="${currentStep?.anchor}"]`);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (currentStep.arrow === "left") {
        setPos({ top: rect.top + rect.height / 2, left: rect.right + 16 });
      } else if (currentStep.arrow === "bottom") {
        setPos({ top: rect.bottom + 12, left: rect.left + rect.width / 2 });
      }
    };
    const t = setTimeout(tryPosition, 300);
    return () => clearTimeout(t);
  }, [step, visible, currentPage]);

  if (!visible) return null;

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  };

  const prev = () => { if (step > 0) setStep(s => s - 1); };

  const isCentered = currentStep?.centered;

  return (
    <>
      {/* Overlay */}
      <div style={{ position: "fixed", inset: 0, zIndex: 9000, pointerEvents: "none" }} />

      {/* Tooltip */}
      <div
        ref={tourRef}
        style={{
          position: "fixed",
          zIndex: 9001,
          ...(isCentered
            ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
            : currentStep?.arrow === "left"
            ? { top: pos.top, left: pos.left, transform: "translateY(-50%)" }
            : { top: pos.top, left: pos.left, transform: "translateX(-50%)" }
          ),
          background: "#fff",
          borderRadius: "16px",
          padding: "20px 22px",
          maxWidth: "300px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06)",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
        }}
      >
        {/* Arrow */}
        {currentStep?.arrow === "left" && (
          <div style={{ position: "absolute", left: -8, top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "8px solid #fff" }} />
        )}
        {currentStep?.arrow === "bottom" && (
          <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: "8px solid #fff" }} />
        )}

        {/* Progress dots */}
        <div style={{ display: "flex", gap: "5px", marginBottom: "12px" }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: i === step ? "18px" : "6px", height: "6px", borderRadius: "3px", background: i === step ? "#2563a8" : "#e2e8f0", transition: "all 0.2s" }} />
          ))}
        </div>

        <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a", marginBottom: "6px" }}>{currentStep?.title}</div>
        <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.6, marginBottom: "16px" }}>{currentStep?.text}</div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={dismiss} style={{ fontSize: "12px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Tour überspringen
          </button>
          <div style={{ display: "flex", gap: "6px" }}>
            {step > 0 && (
              <button onClick={prev} style={{ padding: "6px 12px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                ← Zurück
              </button>
            )}
            <button onClick={next} style={{ padding: "6px 14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
              {step === STEPS.length - 1 ? "Fertig ✓" : "Weiter →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
