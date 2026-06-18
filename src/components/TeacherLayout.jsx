import { useState } from "react";

export default function TeacherLayout({ children, navigate, onLogout, currentUser, activePage }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "🏠" },
    { id: "testEditor", label: "Test erstellen", icon: "✏️" },
    { id: "library", label: "Test-Vorlagen", icon: "📚" },
    { id: "groups", label: "Lerngruppen", icon: "👥" },
    { id: "stats", label: "Statistik", icon: "📊" },
  ];

  const handleNav = (id) => { navigate(id); setMenuOpen(false); };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#f8fafc" }}>

      {/* ── Desktop Sidebar ── */}
      <aside style={{
        width: "240px", background: "#1e3a5f", color: "#fff",
        display: "flex", flexDirection: "column", flexShrink: 0,
        boxShadow: "4px 0 20px rgba(0,0,0,0.15)",
        position: "sticky", top: 0, height: "100vh",
      }} className="desktop-sidebar">
        <style>{`
          @media (max-width: 768px) { .desktop-sidebar { display: none !important; } }
          @media (min-width: 769px) { .mobile-header { display: none !important; } .mobile-menu { display: none !important; } }
        `}</style>

        <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "22px" }}>⚡</span>
            <span style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.5px" }}>QuickTest</span>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "12px 0" }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => handleNav(item.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "12px",
                padding: "12px 20px", border: "none",
                background: activePage === item.id ? "rgba(255,255,255,0.15)" : "transparent",
                color: activePage === item.id ? "#fff" : "rgba(255,255,255,0.7)",
                cursor: "pointer", fontSize: "14px", fontWeight: activePage === item.id ? 700 : 400,
                borderLeft: activePage === item.id ? "3px solid #60a5fa" : "3px solid transparent",
                transition: "all 0.15s",
              }}>
              <span style={{ fontSize: "18px", width: "22px" }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", marginBottom: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentUser?.email}
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 600, textAlign: "left" }}>
            Abmelden
          </button>
        </div>
      </aside>

      {/* ── Mobile Header ── */}
      <div className="mobile-header" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
        background: "#1e3a5f", color: "#fff", padding: "12px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px" }}>⚡</span>
          <span style={{ fontSize: "18px", fontWeight: 800 }}>QuickTest</span>
        </div>
        <button onClick={() => setMenuOpen(v => !v)} style={{
          background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
          borderRadius: "8px", padding: "8px 12px", fontSize: "18px", cursor: "pointer",
        }}>
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* ── Mobile Dropdown Menu ── */}
      {menuOpen && (
        <div className="mobile-menu" style={{
          position: "fixed", top: "52px", left: 0, right: 0, zIndex: 299,
          background: "#1e3a5f", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => handleNav(item.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "12px",
                padding: "14px 20px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: activePage === item.id ? "rgba(255,255,255,0.15)" : "transparent",
                color: "#fff", cursor: "pointer", fontSize: "15px",
                fontWeight: activePage === item.id ? 700 : 400,
              }}>
              <span style={{ fontSize: "20px" }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button onClick={onLogout} style={{
            width: "100%", padding: "14px 20px", border: "none",
            borderTop: "1px solid rgba(255,255,255,0.15)",
            background: "transparent", color: "rgba(255,255,255,0.6)",
            cursor: "pointer", fontSize: "14px", textAlign: "left",
          }}>
            Abmelden
          </button>
        </div>
      )}

      {/* ── Main Content ── */}
      <main style={{ flex: 1, minWidth: 0, paddingTop: 0 }} className="main-content">
        <style>{`
          @media (max-width: 768px) { .main-content { padding-top: 52px !important; } }
        `}</style>
        {children}
      </main>
    </div>
  );
}
