import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import LoginPage from "./pages/LoginPage";
import TeacherDashboard from "./pages/TeacherDashboard";
import TestEditor from "./pages/TestEditor";
import TestLibrary from "./pages/TestLibrary";
import StudentTestView from "./pages/StudentTestView";
import StudentDashboard from "./pages/StudentDashboard";
import GroupManager from "./pages/GroupManager";
import ResultsView from "./pages/ResultsView";

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [studentUser, setStudentUser] = useState(() => {
    // Restore student session from sessionStorage on reload
    try {
      const stored = sessionStorage.getItem("qt_student");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [studentPage, setStudentPage] = useState("dashboard"); // "dashboard" | "test"
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [editingTest, setEditingTest] = useState(null);
  const [viewingResults, setViewingResults] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      if (session?.user) fetchProfile(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        setCurrentPage("dashboard"); // Reset from any previous "login" state
      }
      else setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data);
  };

  const navigate = (page, data = null) => {
    if (page === "testEditor") setEditingTest(data);
    if (page === "results") setViewingResults(data);
    setCurrentPage(page);
  };

  const handleLogin = (_role, userData) => {
    sessionStorage.setItem("qt_student", JSON.stringify(userData));
    setStudentUser(userData);
    setStudentPage("dashboard");
  };

  const handleStudentStartTest = () => {
    setStudentPage("test");
  };

  const handleStudentFinish = async () => {
    setStudentPage("dashboard");
  };

  const handleLogout = async () => {
    if (studentUser) {
      sessionStorage.removeItem("qt_student");
      setStudentUser(null);
      setStudentPage("dashboard");
      setCurrentPage("login");
    } else {
      await supabase.auth.signOut();
      setProfile(null);
    }
  };

  if (session === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚡</div>
        <div style={{ fontSize: "20px", fontWeight: 700 }}>QuickTest</div>
        <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", marginTop: "8px" }}>Wird geladen...</div>
      </div>
    </div>
  );

  // Student flow
  if (studentUser) {
    if (studentPage === "test") {
      return <StudentTestView currentUser={studentUser} onFinish={handleStudentFinish} />;
    }
    return <StudentDashboard currentUser={studentUser} onStartTest={handleStudentStartTest} onLogout={handleLogout} />;
  }

  if (!session || currentPage === "login") return <LoginPage onLogin={handleLogin} />;

  const teacherNav = { navigate, onLogout: handleLogout, currentUser: profile };
  if (currentPage === "dashboard") return <TeacherDashboard {...teacherNav} />;
  if (currentPage === "testEditor") return <TestEditor {...teacherNav} editingTest={editingTest} />;
  if (currentPage === "library") return <TestLibrary {...teacherNav} />;
  if (currentPage === "groups") return <GroupManager {...teacherNav} />;
  if (currentPage === "results") return <ResultsView {...teacherNav} assignment={viewingResults} />;
  return <TeacherDashboard {...teacherNav} />;
}
