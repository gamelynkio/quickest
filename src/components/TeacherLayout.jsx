export default function TeacherLayout({ children, navigate, onLogout, currentUser, activePage }) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "🏠" },
    { id: "testEditor", label: "Test erstellen", icon: "✏️" },
    { id: "groups", label: "Lerngruppen", icon: "👥" },
    { id: "results", label: "Ergebnisse", icon: "📊" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#f8fafc" }}>
      <aside style={{
        width: "240px", background: "#1e3a5f", color: "#fff",
        display: "flex", flexDirection: "column", flexShrink: 0,
        boxShadow: "4px 0 20px rgba(0,0,0,0.15)"
      }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "22px" }}>⚡</span>
            <span style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.5px" }}>QuickTest</span>
          </div>
          <div style={{
            marginTop: "8px", background: "rgba(255,255,255,0.1)",
            borderRadius: "6px", padding: "4px 8px", fontSize: "11px",
            color: "rgba(255,255,255,0.7)", display: "inline-block"
          }}>
            Free-Version · 30 Tests/Monat
          </div>
        </div>

        <nav style={{ flex: 1, padding: "12px 0" }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => navigate(item.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "12px",
                padding: "12px 20px", border: "none",
                background: activePage === item.id ? "rgba(255,255,255,0.15)" : "transparent",
                color: activePage === item.id ? "#fff" : "rgba(255,255,255,0.65)",
                cursor: "pointer", fontSize: "14px", fontWeight: activePage === item.id ? 600 : 400,
                textAlign: "left", borderLeft: activePage === item.id ? "3px solid #60a5fa" : "3px solid transparent",
                transition: "all 0.15s"
              }}>
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{
            background: "linear-gradient(135deg, #2563a8, #7c3aed)",
            borderRadius: "10px", padding: "12px", marginBottom: "12px"
          }}>
            <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "4px" }}>⭐ Premium freischalten</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.8)" }}>Unbegrenzte Tests, KI-Generator & Marktplatz</div>
            <button style={{
              marginTop: "8px", width: "100%", padding: "6px",
              background: "#fff", color: "#1e3a5f", border: "none",
              borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer"
            }}>Jetzt upgraden</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "34px", height: "34px", borderRadius: "50%",
              background: "#2563a8", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "14px", fontWeight: 700, flexShrink: 0
            }}>
              {currentUser?.name?.[0] || "L"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {currentUser?.name || "Lehrkraft"}
              </div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>Lehrer-Account</div>
            </div>
            <button onClick={onLogout} title="Abmelden" style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.5)",
              cursor: "pointer", fontSize: "16px", padding: "4px"
            }}>⏏</button>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: "auto" }}>
        {children}
      </main>
    </div>
  );
}
