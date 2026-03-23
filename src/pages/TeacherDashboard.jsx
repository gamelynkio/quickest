import TeacherLayout from "../components/TeacherLayout";

const DEMO_TESTS = [
  { id: 1, title: "Mathe – Bruchrechnung Kl. 6", questions: 12, group: "6a", status: "aktiv", submissions: 18, total: 24, avgScore: 76 },
  { id: 2, title: "Deutsch – Grammatik", questions: 8, group: "7b", status: "beendet", submissions: 22, total: 22, avgScore: 82 },
  { id: 3, title: "Englisch – Simple Past", questions: 15, group: "8c", status: "entwurf", submissions: 0, total: 28, avgScore: null },
];

const STATUS_STYLE = {
  aktiv: { bg: "#dcfce7", color: "#16a34a", label: "Aktiv" },
  beendet: { bg: "#f1f5f9", color: "#64748b", label: "Beendet" },
  entwurf: { bg: "#fef9c3", color: "#ca8a04", label: "Entwurf" },
};

export default function TeacherDashboard({ navigate, onLogout, currentUser }) {
  const stats = [
    { label: "Tests gesamt", value: "3", icon: "📋", color: "#2563a8" },
    { label: "Aktive Tests", value: "1", icon: "🟢", color: "#16a34a" },
    { label: "Lerngruppen", value: "3", icon: "👥", color: "#7c3aed" },
    { label: "Tests diesen Monat", value: "3 / 30", icon: "📅", color: "#ea580c" },
  ];

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="dashboard">
      <div style={{ padding: "32px" }}>
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
            Guten Morgen, {currentUser?.name?.split(" ")[0]} 👋
          </h1>
          <p style={{ color: "#64748b", marginTop: "4px", fontSize: "14px" }}>
            Hier ist deine Übersicht für heute.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
          {stats.map(s => (
            <div key={s.label} style={{
              background: "#fff", borderRadius: "14px", padding: "20px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0"
            }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>{s.icon}</div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Meine Tests</h2>
            <button onClick={() => navigate("testEditor", null)} style={{
              padding: "9px 18px", background: "#2563a8", color: "#fff",
              border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px",
              cursor: "pointer"
            }}>
              ✏️ Neuer Test
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Test", "Gruppe", "Aufgaben", "Abgaben", "Ø Ergebnis", "Status", "Aktionen"].map(h => (
                  <th key={h} style={{ padding: "12px 20px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEMO_TESTS.map((test, i) => {
                const s = STATUS_STYLE[test.status];
                return (
                  <tr key={test.id} style={{ borderBottom: i < DEMO_TESTS.length - 1 ? "1px solid #f8fafc" : "none" }}>
                    <td style={{ padding: "14px 20px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>{test.title}</td>
                    <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>{test.group}</td>
                    <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>{test.questions}</td>
                    <td style={{ padding: "14px 20px", fontSize: "13px", color: "#64748b" }}>
                      {test.submissions}/{test.total}
                      <div style={{ marginTop: "4px", background: "#e2e8f0", borderRadius: "4px", height: "4px", width: "60px" }}>
                        <div style={{ background: "#2563a8", borderRadius: "4px", height: "4px", width: `${(test.submissions / test.total) * 60}px` }} />
                      </div>
                    </td>
                    <td style={{ padding: "14px 20px", fontSize: "13px", fontWeight: 600, color: test.avgScore ? "#16a34a" : "#94a3b8" }}>
                      {test.avgScore ? `${test.avgScore}%` : "–"}
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <span style={{ background: s.bg, color: s.color, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 600 }}>
                        {s.label}
                      </span>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <button onClick={() => navigate("results")} style={{
                        padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px",
                        background: "#fff", fontSize: "12px", cursor: "pointer", color: "#374151", marginRight: "6px"
                      }}>Ergebnisse</button>
                      <button onClick={() => navigate("testEditor", test)} style={{
                        padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px",
                        background: "#fff", fontSize: "12px", cursor: "pointer", color: "#374151"
                      }}>Bearbeiten</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "20px" }}>
          <div onClick={() => navigate("groups")} style={{
            background: "#fff", borderRadius: "14px", padding: "20px",
            border: "2px dashed #e2e8f0", cursor: "pointer", textAlign: "center"
          }}
            onMouseOver={e => e.currentTarget.style.borderColor = "#2563a8"}
            onMouseOut={e => e.currentTarget.style.borderColor = "#e2e8f0"}
          >
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>👥</div>
            <div style={{ fontWeight: 600, color: "#374151" }}>Neue Lerngruppe</div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>Schüler anlegen & Benutzernamen generieren</div>
          </div>
          <div style={{
            background: "linear-gradient(135deg, #1e3a5f, #2563a8)",
            borderRadius: "14px", padding: "20px", cursor: "pointer", textAlign: "center", opacity: 0.7
          }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>🤖</div>
            <div style={{ fontWeight: 600, color: "#fff" }}>KI-Test-Generator</div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", marginTop: "4px" }}>Nur Premium · Bald verfügbar</div>
          </div>
        </div>
      </div>
    </TeacherLayout>
  );
}
