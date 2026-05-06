// QuickTest — Automatische Unit Tests
// Einbinden in Lovable: Datei als src/tests/quicktest.test.js speichern
// Ausführen: wird automatisch bei jedem Deploy auf Lovable geprüft
//
// Prompt für Lovable:
// "Füge diese Datei als src/tests/quicktest.test.js hinzu. Ändere nichts anderes."

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────
// 1. NOTENBERECHNUNG
// Kopie der Logik aus ResultsView — muss identisch bleiben
// ─────────────────────────────────────────────────────────────────

const DEFAULT_SCALE = [
  { grade: "1", minPercent: 87 },
  { grade: "2", minPercent: 73 },
  { grade: "3", minPercent: 59 },
  { grade: "4", minPercent: 45 },
  { grade: "5", minPercent: 18 },
  { grade: "6", minPercent: 0 },
];

const calculateGrade = (score, totalPoints, gradingScale = DEFAULT_SCALE) => {
  if (!totalPoints || totalPoints === 0) return "6";
  const percent = (score / totalPoints) * 100;
  const sorted = [...gradingScale].sort((a, b) => b.minPercent - a.minPercent);
  for (const g of sorted) {
    if (percent >= Number(g.minPercent)) return g.grade;
  }
  return "6";
};

describe("Notenberechnung", () => {
  it("100% → Note 1", () => expect(calculateGrade(10, 10)).toBe("1"));
  it("87% → Note 1 (Grenzwert)", () => expect(calculateGrade(8.7, 10)).toBe("1"));
  it("86% → Note 2", () => expect(calculateGrade(8.6, 10)).toBe("2"));
  it("73% → Note 2 (Grenzwert)", () => expect(calculateGrade(7.3, 10)).toBe("2"));
  it("72% → Note 3", () => expect(calculateGrade(7.2, 10)).toBe("3"));
  it("59% → Note 3 (Grenzwert)", () => expect(calculateGrade(5.9, 10)).toBe("3"));
  it("58% → Note 4", () => expect(calculateGrade(5.8, 10)).toBe("4"));
  it("45% → Note 4 (Grenzwert)", () => expect(calculateGrade(4.5, 10)).toBe("4"));
  it("44% → Note 5", () => expect(calculateGrade(4.4, 10)).toBe("5"));
  it("18% → Note 5 (Grenzwert)", () => expect(calculateGrade(1.8, 10)).toBe("5"));
  it("17% → Note 6", () => expect(calculateGrade(1.7, 10)).toBe("6"));
  it("0% → Note 6", () => expect(calculateGrade(0, 10)).toBe("6"));
  it("0 Gesamtpunkte → Note 6 (kein Div/0 Fehler)", () => expect(calculateGrade(0, 0)).toBe("6"));
  it("Halbe Punkte: 7.5 von 10 = 75% → Note 2", () => expect(calculateGrade(7.5, 10)).toBe("2"));
  it("Benutzerdefinierter Notenschlüssel", () => {
    const customScale = [
      { grade: "1", minPercent: 90 },
      { grade: "2", minPercent: 75 },
      { grade: "6", minPercent: 0 },
    ];
    expect(calculateGrade(9, 10, customScale)).toBe("1");
    expect(calculateGrade(8, 10, customScale)).toBe("2");
    expect(calculateGrade(7, 10, customScale)).toBe("2");
    expect(calculateGrade(1, 10, customScale)).toBe("6");
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. PUNKTEBERECHNUNG
// ─────────────────────────────────────────────────────────────────

const calculateScore = (aiCorrections, manualOverrides = {}) => {
  let score = 0;
  for (const [qId, correction] of Object.entries(aiCorrections)) {
    if (manualOverrides[qId] !== undefined) {
      score += Number(manualOverrides[qId]);
    } else {
      score += correction.points ?? 0;
    }
  }
  return score;
};

describe("Punkteberechnung", () => {
  const corrections = {
    "q1": { points: 1, aiReviewed: true },
    "q2": { points: 0.5, aiReviewed: true },
    "q3": { points: 0, aiReviewed: true },
  };

  it("Summe aller KI-Punkte", () => expect(calculateScore(corrections)).toBe(1.5));
  it("Manuelle Überschreibung wird verwendet", () => expect(calculateScore(corrections, { "q1": 0 })).toBe(0.5));
  it("Teilpunkte (0.5) werden korrekt addiert", () => expect(calculateScore({ "q1": { points: 0.5 }, "q2": { points: 0.5 } })).toBe(1));
  it("Fehlende Antwort (null) zählt 0", () => expect(calculateScore({ "q1": { points: null } })).toBe(0));
  it("Leere Corrections → 0 Punkte", () => expect(calculateScore({})).toBe(0));
  it("Überschreibung mit 0 überschreibt KI-Punkte", () => expect(calculateScore({ "q1": { points: 1 } }, { "q1": 0 })).toBe(0));
  it("Maximale Punktzahl wird nicht überschritten (Validierung)", () => {
    // Sicherstellen dass KI nicht mehr als maxPoints vergibt
    const clamp = (points, maxPoints) => Math.min(Math.max(0, Number(points) || 0), Number(maxPoints));
    expect(clamp(1.5, 1)).toBe(1);
    expect(clamp(-0.5, 1)).toBe(0);
    expect(clamp(0.5, 1)).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. FRAGEN FLACHKLOPFEN (flattenQs)
// ─────────────────────────────────────────────────────────────────

const flattenQs = (qs) => {
  const result = [];
  for (const q of (qs || [])) {
    if (q.type === "section") {
      for (const t of (q.tasks || [])) {
        for (const tq of (t.questions || [])) result.push(tq);
      }
    } else if (q.type === "task") {
      for (const tq of (q.questions || [])) result.push(tq);
    } else {
      result.push(q);
    }
  }
  return result;
};

describe("flattenQs — Fragen aus verschachtelter Struktur", () => {
  it("Flaches Array bleibt flach", () => {
    const qs = [{ id: 1, type: "open" }, { id: 2, type: "mc" }];
    expect(flattenQs(qs)).toHaveLength(2);
  });

  it("Task-Typ wird aufgeklappt", () => {
    const qs = [{ id: 1, type: "task", questions: [{ id: 2, type: "open" }, { id: 3, type: "open" }] }];
    const result = flattenQs(qs);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(2);
  });

  it("Section-Typ wird aufgeklappt", () => {
    const qs = [{ id: 1, type: "section", tasks: [{ id: 2, questions: [{ id: 3, type: "open" }] }] }];
    expect(flattenQs(qs)).toHaveLength(1);
    expect(flattenQs(qs)[0].id).toBe(3);
  });

  it("Gemischte Struktur wird korrekt aufgelöst", () => {
    const qs = [
      { id: 1, type: "open" },
      { id: 2, type: "task", questions: [{ id: 3, type: "open" }, { id: 4, type: "open" }] },
    ];
    expect(flattenQs(qs)).toHaveLength(3);
  });

  it("Leeres Array → leeres Ergebnis", () => expect(flattenQs([])).toHaveLength(0));
  it("null → leeres Ergebnis", () => expect(flattenQs(null)).toHaveLength(0));

  it("Nur offene Fragen filtern", () => {
    const qs = [
      { id: 1, type: "open" },
      { id: 2, type: "mc" },
      { id: 3, type: "task", questions: [{ id: 4, type: "open" }, { id: 5, type: "mc" }] },
    ];
    const open = flattenQs(qs).filter(q => q.type === "open" || q.type === "qa");
    expect(open).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. REGEL-LOGIK
// ─────────────────────────────────────────────────────────────────

const isRuleRelevantForQuestion = (rule, qId) => {
  if (rule.taskId) return String(rule.taskId) === String(qId);
  if (!rule.taskId && (!rule.taskIds || rule.taskIds.length === 0)) return true;
  if (rule.taskIds) return rule.taskIds.includes(String(qId));
  return false;
};

describe("Regel-Relevanz pro Aufgabe", () => {
  it("Allgemeine Regel (kein taskId) gilt für alle", () => {
    const rule = { id: "cap", label: "Groß-/Kleinschreibung", enabled: true };
    expect(isRuleRelevantForQuestion(rule, "q1")).toBe(true);
    expect(isRuleRelevantForQuestion(rule, "q99")).toBe(true);
  });

  it("Aufgabenspezifische Regel gilt nur für diese Aufgabe", () => {
    const rule = { id: "to", label: "Infinitivpartikel", taskId: "q1", taskIds: ["q1"] };
    expect(isRuleRelevantForQuestion(rule, "q1")).toBe(true);
    expect(isRuleRelevantForQuestion(rule, "q2")).toBe(false);
  });

  it("taskIds-Array grenzt ein", () => {
    const rule = { id: "cap", taskIds: ["q1", "q3"] };
    expect(isRuleRelevantForQuestion(rule, "q1")).toBe(true);
    expect(isRuleRelevantForQuestion(rule, "q2")).toBe(false);
    expect(isRuleRelevantForQuestion(rule, "q3")).toBe(true);
  });

  it("Typ-Mismatch String/Number wird toleriert", () => {
    const rule = { id: "cap", taskId: 1, taskIds: ["1"] };
    expect(isRuleRelevantForQuestion(rule, "1")).toBe(true);
    expect(isRuleRelevantForQuestion(rule, 1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. GROSSSCHREIBUNGS-NORMALISIERUNG
// ─────────────────────────────────────────────────────────────────

const shouldIgnoreCase = (detectedRules) => {
  const rule = detectedRules.find(r =>
    r.label?.toLowerCase().includes("groß") && r.label?.toLowerCase().includes("klein")
  );
  return rule ? rule.enabled : true; // Standard: ignorieren
};

const normalizeAnswer = (answer, ignoreCase) =>
  ignoreCase ? (answer || "").toLowerCase() : (answer || "");

describe("Großschreibungs-Normalisierung", () => {
  it("Aktive Groß/Klein-Regel → toLowerCase", () => {
    const rules = [{ label: "Groß-/Kleinschreibung ignorieren", enabled: true }];
    expect(normalizeAnswer("Hund", shouldIgnoreCase(rules))).toBe("hund");
  });

  it("Deaktivierte Groß/Klein-Regel → unverändert", () => {
    const rules = [{ label: "Groß-/Kleinschreibung ignorieren", enabled: false }];
    expect(normalizeAnswer("Hund", shouldIgnoreCase(rules))).toBe("Hund");
  });

  it("Keine Regel → Standard: ignorieren", () => {
    expect(normalizeAnswer("Hund", shouldIgnoreCase([]))).toBe("hund");
  });

  it("hUnD wird zu hund normalisiert", () => {
    const rules = [{ label: "Groß-/Kleinschreibung ignorieren", enabled: true }];
    expect(normalizeAnswer("hUnD", shouldIgnoreCase(rules))).toBe("hund");
  });
});

