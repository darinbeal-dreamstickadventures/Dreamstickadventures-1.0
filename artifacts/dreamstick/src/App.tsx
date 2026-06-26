import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Watch from "@/pages/watch";

const queryClient = new QueryClient();

function Home() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0015]">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-yellow-400 drop-shadow-[0_0_12px_#FFD700]">
          ✨ DreamStick Adventures
        </h1>
        <p className="mt-2 text-purple-300">Personalised bedtime story videos for your child</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/watch" component={Watch} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
