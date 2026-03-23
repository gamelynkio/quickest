import { useState, useEffect } from "react";
import { useAuth } from "./hooks/useAuth";
import LoginPage from "./pages/LoginPage";
import TeacherDashboard from "./pages/TeacherDashboard";
import TestEditor from "./pages/TestEditor";
import TestLibrary from "./pages/TestLibrary";
import StudentTestView from "./pages/StudentTestView";
import GroupManager from "./pages/GroupManager";
import ResultsView from "./pages/ResultsView";

export default function App() {
  const { user, profile, loading, signOut } = useAuth();
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [studentUser, setStudentUser] = useState(null);
  const [editingTest, setEditingTest] = useState(null);
  const [activeTest, setActiveTest] = useState(null);
  const [viewingResults, setViewingResults] = useState(null);

  const navigate = (page, data = null) => {
    if (page === "testEditor") setEditingTest(data);
    if (page === "studentTest") setActiveTest(data);
    if (page === "results") setViewingResults(data);
    setCurrentPage(page);
  };

  const handleLogin = (role, userData) => {
    if (role === "student") {
      setStudentUser(userData);
      setCurrentPage("studentTest");
    }
    // teacher login is handled by useAuth automatically
  };

  const handleLogout = async () => {
    if (studentUser) {
      setStudentUser(null);
      setCurrentPage("dashboard");
    } else {
      await signOut();
    }
  };

  // Loading screen
  if (loading) return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #1e3a5f, #2563a8)",
      fontFamily: "'Segoe UI', system-ui, sans-serif"
    }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚡</div>
        <div style={{ fontSize: "20px", fontWeight: 700 }}>QuickTest</div>
        <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", marginTop: "8px" }}>Wird geladen...</div>
      </div>
    </div>
  );

  // Not logged in
  if (!user && !studentUser) return <LoginPage onLogin={handleLogin} />;

  // Student view
  if (studentUser) {
    return <StudentTestView currentUser={studentUser} onFinish={handleLogout} />;
  }

  // Teacher views
  const teacherNav = { navigate, onLogout: handleLogout, currentUser: profile };

  if (currentPage === "dashboard") return <TeacherDashboard {...teacherNav} />;
  if (currentPage === "testEditor") return <TestEditor {...teacherNav} editingTest={editingTest} />;
  if (currentPage === "library") return <TestLibrary {...teacherNav} />;
  if (currentPage === "groups") return <GroupManager {...teacherNav} />;
  if (currentPage === "results") return <ResultsView {...teacherNav} assignment={viewingResults} />;

  return <TeacherDashboard {...teacherNav} />;
}
