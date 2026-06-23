import { ExecutionResult } from "@workspace/api-client-react/src/generated/api.schemas";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Clock, CheckCircle2, XCircle } from "lucide-react";

interface OutputPanelProps {
  result: ExecutionResult | null;
  isExecuting: boolean;
}

export function OutputPanel({ result, isExecuting }: OutputPanelProps) {
  if (isExecuting) {
    return (
      <div className="h-full flex items-center justify-center bg-card text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="font-mono text-xs animate-pulse tracking-wide">Executing in container...</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center bg-card text-muted-foreground">
        <div className="flex flex-col items-center gap-3 opacity-30">
          <Terminal className="w-12 h-12" />
          <p className="font-mono text-sm tracking-wide">Output will appear here</p>
        </div>
      </div>
    );
  }

  const isSuccess = result.exitCode === 0;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0b]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <XCircle className="w-4 h-4 text-destructive" />
          )}
          <span className="font-mono text-xs font-semibold text-foreground">
            Exit Code: {result.exitCode}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground bg-background px-2 py-1 rounded-md border border-border">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-mono text-xs font-medium">{result.durationMs}ms</span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-4">
        {result.stdout && (
          <div className="mb-4 last:mb-0">
            <pre className="font-mono text-[13px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
              {result.stdout}
            </pre>
          </div>
        )}
        {result.stderr && (
          <div className="mb-4 last:mb-0">
            <pre className="font-mono text-[13px] leading-relaxed text-red-400 whitespace-pre-wrap break-all">
              {result.stderr}
            </pre>
          </div>
        )}
        {!result.stdout && !result.stderr && (
          <div className="text-muted-foreground font-mono text-xs italic opacity-40">
            (No output)
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
