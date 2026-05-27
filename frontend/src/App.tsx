import { useAuth } from "@/hooks/useAuth";
import { DashboardPage } from "@/pages/DashboardPage";

export default function App() {
  const { user, logout } = useAuth();

  return (
    <DashboardPage
      user={user}
      onLogout={logout}
    />
  );
}
