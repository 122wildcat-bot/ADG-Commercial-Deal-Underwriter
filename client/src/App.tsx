import { Switch, Route, Router, useLocation, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getToken, getStoredUser } from "@/lib/auth";

import { LoginPage } from "@/pages/LoginPage";
import { SignupPage } from "@/pages/SignupPage";
import { DealsListPage } from "@/pages/DealsListPage";
import { DealEditorPage } from "@/pages/DealEditorPage";
import { DealAnalysisPage } from "@/pages/DealAnalysisPage";
import { AdminPage } from "@/pages/AdminPage";
import { PendingPage } from "@/pages/PendingPage";
import { AppShell } from "@/components/AppShell";

function Protected({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const token = getToken();
  const user = getStoredUser();
  if (!token) {
    navigate("/login");
    return null;
  }
  if (user?.status === "pending") {
    return <Redirect to="/pending" />;
  }
  return <AppShell>{children}</AppShell>;
}

function Routes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/pending" component={PendingPage} />
      <Route path="/">
        <Protected><DealsListPage /></Protected>
      </Route>
      <Route path="/deals/new">
        <Protected><DealEditorPage /></Protected>
      </Route>
      <Route path="/deals/:id/edit">
        {(p) => <Protected><DealEditorPage id={p.id} /></Protected>}
      </Route>
      <Route path="/deals/:id">
        {(p) => <Protected><DealAnalysisPage id={p.id} /></Protected>}
      </Route>
      <Route path="/admin">
        <Protected><AdminPage /></Protected>
      </Route>
      <Route>
        {/* Graceful root for anything else */}
        <Protected><DealsListPage /></Protected>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Routes />
      </Router>
    </QueryClientProvider>
  );
}
