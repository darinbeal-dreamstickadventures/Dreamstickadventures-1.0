import { useState } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Editor } from "@/components/Editor";
import { OutputPanel } from "@/components/OutputPanel";
import { HistorySidebar } from "@/components/HistorySidebar";
import { useExecuteCode, getGetHistoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HistoryEntry, ExecutionResult } from "@workspace/api-client-react/src/generated/api.schemas";
import { Terminal } from "lucide-react";

export default function Home() {
  const [code, setCode] = useState("console.log('Hello, Node.js!');");
  const [currentResult, setCurrentResult] = useState<ExecutionResult | null>(null);

  const queryClient = useQueryClient();
  const executeCode = useExecuteCode();

  const handleExecute = () => {
    if (!code.trim()) return;
    executeCode.mutate({ data: { code } }, {
      onSuccess: (result) => {
        setCurrentResult(result);
        queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
      },
      onError: (error) => {
        toast.error("Execution failed");
      }
    });
  };

  const handleSelectHistory = (entry: HistoryEntry) => {
    setCode(entry.code);
    setCurrentResult({
      id: entry.id,
      code: entry.code,
      stdout: entry.stdout,
      stderr: entry.stderr,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      executedAt: entry.executedAt
    });
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      <HistorySidebar onSelect={handleSelectHistory} />
      <div className="flex-1 flex flex-col h-full">
        <header className="h-14 border-b border-border flex items-center px-6 shrink-0 bg-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center border border-primary/20">
              <Terminal className="w-4 h-4 text-primary" />
            </div>
            <h1 className="font-semibold text-sm tracking-wide text-foreground font-mono">NODE_REPL v1.0</h1>
          </div>
        </header>
        <ResizablePanelGroup direction="vertical" className="flex-1">
          <ResizablePanel defaultSize={60} minSize={20}>
            <Editor 
              code={code} 
              onChange={setCode} 
              onExecute={handleExecute}
              isExecuting={executeCode.isPending}
            />
          </ResizablePanel>
          <ResizableHandle className="bg-border h-1 transition-colors hover:bg-primary/50" />
          <ResizablePanel defaultSize={40} minSize={20}>
            <OutputPanel result={currentResult} isExecuting={executeCode.isPending} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
