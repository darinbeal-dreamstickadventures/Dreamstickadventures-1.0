import { useGetHistory, useClearHistory, getGetHistoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { HistoryEntry } from "@workspace/api-client-react/src/generated/api.schemas";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Trash2, History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface HistorySidebarProps {
  onSelect: (entry: HistoryEntry) => void;
}

export function HistorySidebar({ onSelect }: HistorySidebarProps) {
  const queryClient = useQueryClient();
  const { data: history = [], isLoading } = useGetHistory({ 
    query: { queryKey: getGetHistoryQueryKey() } 
  });
  
  const clearHistory = useClearHistory();

  const handleClear = () => {
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetHistoryQueryKey() });
      }
    });
  };

  return (
    <div className="w-72 border-r border-border bg-card flex flex-col h-full shrink-0">
      <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-foreground">
          <History className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm tracking-wide font-mono">History</h2>
        </div>
        <Button 
          data-testid="button-clear-history"
          variant="ghost" 
          size="icon" 
          className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleClear}
          disabled={history.length === 0 || clearHistory.isPending}
          title="Clear history"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse flex flex-col gap-2">
                <div className="h-4 bg-muted rounded w-1/3"></div>
                <div className="h-3 bg-muted rounded w-full"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-3 opacity-40 mt-10">
            <History className="w-10 h-10" />
            <div className="space-y-1">
              <p className="text-sm font-medium font-mono">No history</p>
              <p className="text-xs">Run code to see it here</p>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {history.map((entry) => (
              <button
                key={entry.id}
                data-testid={`button-history-entry-${entry.id}`}
                onClick={() => onSelect(entry)}
                className="w-full text-left p-3 rounded-md hover:bg-muted/60 transition-colors group border border-transparent hover:border-border/50"
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.exitCode === 0 ? 'bg-emerald-500' : 'bg-destructive'}`} />
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                      {entry.exitCode === 0 ? 'SUCCESS' : 'ERROR'}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                    {formatDistanceToNow(new Date(entry.executedAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="font-mono text-xs text-foreground/80 line-clamp-3 leading-relaxed group-hover:text-foreground">
                  {entry.code}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
