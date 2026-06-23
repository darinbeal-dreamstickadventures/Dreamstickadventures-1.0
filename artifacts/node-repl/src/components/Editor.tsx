import { KeyboardEvent, useRef } from "react";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EditorProps {
  code: string;
  onChange: (code: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
}

export function Editor({ code, onChange, onExecute, isExecuting }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onExecute();
    }
    
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = code.substring(0, start) + "  " + code.substring(end);
      onChange(newValue);
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  const lines = code.split('\n');

  return (
    <div className="flex flex-col h-full bg-background relative group">
      <div className="absolute top-4 right-4 z-10">
        <Button 
          data-testid="button-execute"
          onClick={onExecute} 
          disabled={isExecuting || !code.trim()}
          size="sm"
          className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border border-primary/20 transition-all font-mono text-xs font-semibold gap-2 shadow-none"
        >
          {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isExecuting ? "Running..." : "Run (Cmd+Enter)"}
        </Button>
      </div>
      <div className="flex-1 overflow-hidden relative flex bg-background">
        <div className="w-12 shrink-0 bg-card border-r border-border flex flex-col items-end py-4 pr-3 select-none text-muted-foreground font-mono text-[13px] leading-[1.5rem] opacity-40">
          {lines.map((_, i) => (
            <div key={i} className="h-[1.5rem] flex items-center">{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-1 w-full h-full p-4 bg-transparent resize-none outline-none font-mono text-[13px] leading-[1.5rem] text-foreground placeholder:text-muted-foreground selection:bg-primary/30"
          placeholder="Type Node.js code here..."
        />
      </div>
    </div>
  );
}
