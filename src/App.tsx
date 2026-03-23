import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import TeacherDashboard from "./pages/TeacherDashboard";
import TestEditor from "./pages/TestEditor";
import StudentTestView from "./pages/StudentTestView";
import GroupManager from "./pages/GroupManager";
import ResultsView from "./pages/ResultsView";

export default function App() {
  const [currentPage, setCurrentPage] = useState("login");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [editingTest, setEditingTest] = useState<any>(null);
  const [activeTest, setActiveTest] = useState<any>(null);

  const navigate = (page: string, data: any = null) => {
    if (page === "testEditor") setEditingTest(data);
    if (page === "studentTest") setActiveTest(data);
    setCurrentPage(page);
  };

  const handleLogin = (role: string, user: any) => {
    setUserRole(role);
    setCurrentUser(user);
    setCurrentPage(role === "teacher" ? "dashboard" : "studentTest");
  };

  const handleLogout = () => {
    setUserRole(null);
    setCurrentUser(null);
    setCurrentPage("login");
  };

  if (currentPage === "login") return <LoginPage onLogin={handleLogin} />;

  if (userRole === "teacher") {
    const teacherNav = { navigate, onLogout: handleLogout, currentUser };
    if (currentPage === "dashboard") return <TeacherDashboard {...teacherNav} />;
    if (currentPage === "testEditor") return <TestEditor {...teacherNav} editingTest={editingTest} />;
    if (currentPage === "groups") return <GroupManager {...teacherNav} />;
    if (currentPage === "results") return <ResultsView {...teacherNav} />;
  }

  if (userRole === "student") {
    return <StudentTestView test={activeTest} currentUser={currentUser} onFinish={handleLogout} />;
  }

  return <LoginPage onLogin={handleLogin} />;
}
