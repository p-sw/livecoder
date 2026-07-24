// ponytail: agent panel with Tailwind utility classes. Chat bubbles,
// adapter picker, compose form, and the empty-state hint all map
// 1:1 from the hand-rolled .agent-* / .chat-* / .bubble-* rules.

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowUp, Bot, Send, Sparkles, Terminal, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { useWorkspaceStore, type ChatMessage } from '../workspace-context';
import { cn } from '../lib/utils';

export function AgentPanel() {
  const store = useWorkspaceStore();
  const navigate = useNavigate();
  const {
    workspace,
    chatMessages,
    chatInput,
    agentBusy,
    agentConnection,
    agentConfigured,
    adapters,
    activeAdapter,
  } = store;

  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chatMessages]);

  if (!workspace) return null;

  const statusLabel = agentConnection === 'thinking' ? 'working' : agentConnection === 'connecting' ? 'connecting' : agentConnection === 'error' ? 'offline' : agentConnection === 'idle' ? 'standby' : 'ready';
  const submit = (event: FormEvent) => { event.preventDefault(); void store.sendChat(); };
  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); void store.sendChat();
    }
  };
  const statusTone = agentConnection === 'error'
    ? 'text-danger'
    : agentConnection === 'idle' ? 'text-subtle' : 'text-fg';
  const dotTone = agentConnection === 'thinking' ? 'bg-accent shadow-[0_0_0_3px_rgba(82,223,160,0.1)] animate-pulse' : 'bg-accent-strong';

  return (
    <aside className="bg-[#0d141d] flex flex-col h-full">
      <div className="h-16 shrink-0 flex items-center justify-between pl-4 pr-3.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/files' })} aria-label="Back to files" className="md:hidden">
            <ArrowLeft size={17} />
          </Button>
          <div className="w-[28px] h-[28px] grid place-items-center rounded-md text-blue bg-blue/10">
            <Bot size={17} />
          </div>
          <div>
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">PI / ACP</div>
            <h2 className="m-0 mt-1 text-fg text-sm font-semibold tracking-[-0.02em]">Pi agent</h2>
          </div>
        </div>
        <div className={cn('flex items-center gap-2 text-[11px] font-mono', statusTone)}>
          <span className={cn('w-1.5 h-1.5 rounded-full', dotTone)} />
          {statusLabel}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 mb-1 mx-3.5 p-2 border border-purple/15 rounded-md bg-purple/[0.045]">
        <div className="w-[25px] h-[25px] grid place-items-center rounded-md text-purple bg-purple/10">
          <Zap size={14} />
        </div>
        <div>
          <span className="text-subtle font-mono text-[8px] tracking-[0.1em]">WORKING IN</span>
          <strong title={workspace.path} className="block text-[#d9cef2] font-mono text-[11px] font-medium">{workspace.name}</strong>
        </div>
      </div>
      {adapters.length > 1 && (
        <div role="tablist" aria-label="Adapter" className="flex gap-1 p-0.5 m-3.5 mt-1 border border-border rounded-md bg-[rgba(255,255,255,0.018)]">
          {adapters.map((adapter) => (
            <button
              key={adapter.id}
              type="button"
              role="tab"
              aria-selected={adapter.id === activeAdapter}
              onClick={() => store.setActiveAdapter(adapter.id)}
              title={adapter.installed ? `Use ${adapter.label}` : `${adapter.label} is not installed`}
              className={cn(
                'relative flex-1 inline-flex items-center justify-center gap-1.5 min-h-7 px-2.5 border-0 rounded text-[10px] tracking-[0.04em] transition-colors duration-150',
                adapter.id === activeAdapter ? 'bg-accent text-fg-on-accent shadow-[0_0_0_1px_rgba(141,244,189,0.18)]' : 'bg-transparent text-muted hover:bg-surface-hover',
                !adapter.installed && adapter.id === activeAdapter && 'bg-[rgba(255,141,155,0.12)] text-danger shadow-[0_0_0_1px_rgba(255,141,155,0.22)]',
              )}
            >
              {adapter.label}
              {!adapter.installed && <span className="w-1 h-1 ml-1 rounded-full bg-subtle" />}
            </button>
          ))}
        </div>
      )}
      <ScrollArea className="ui-scroll-area" ref={messagesRef}>
        <div className="flex flex-col gap-3 px-3 pt-3 pb-5" aria-live="polite">
          {agentConfigured === false && (
            <div className="flex items-start gap-2 px-3 py-2.5 border border-blue/15 rounded-md bg-blue/[0.04] text-[12px] text-blue">
              <Terminal size={15} className="mt-0.5 shrink-0" />
              <div>
                <strong className="block text-fg">Pi ACP will start on first message.</strong>
                <span>Make sure <code className="px-1 py-px border border-border rounded text-[11px] font-mono text-fg">pi</code> and a model provider are configured on this machine.</span>
              </div>
            </div>
          )}
          {chatMessages.map((message) => <ChatBubble key={message.id} message={message} />)}
          {agentBusy && chatMessages.every((message) => !message.streaming) && (
            <div className="flex items-center gap-2.5 text-muted text-[12px]">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              </span>
              Pi is thinking
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="px-3 pb-3">
        {chatMessages.length <= 1 && (
          <div className="flex gap-1.5 overflow-auto py-0 mb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => void store.sendChat('Give me a quick tour of this workspace')}
              className="inline-flex items-center gap-1 flex-shrink-0 px-2 py-1.5 border border-border rounded bg-transparent text-muted text-[10px]"
            >
              Tour this workspace <ArrowUp size={12} />
            </button>
            <button
              type="button"
              onClick={() => void store.sendChat('Find the main entry point')}
              className="inline-flex items-center gap-1 flex-shrink-0 px-2 py-1.5 border border-border rounded bg-transparent text-muted text-[10px]"
            >
              Find the entry point <ArrowUp size={12} />
            </button>
          </div>
        )}
        <form onSubmit={submit} className="flex items-center gap-1.5 mb-1">
          <textarea
            value={chatInput}
            onChange={(event) => store.setChatInput(event.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask Pi anything…"
            rows={1}
            aria-label="Message Pi agent"
            className="flex-1 min-h-9 max-h-40 px-3 py-2 border border-border rounded-md bg-bg text-fg text-[13px] resize-none outline-none focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(141,244,189,0.08)] placeholder:text-subtle"
          />
          <Button type="submit" size="icon" disabled={!chatInput.trim() || agentBusy} aria-label="Send message">
            <Send size={16} />
          </Button>
        </form>
        <div className="flex items-center justify-between text-subtle text-[9px] font-mono">
          <span>Pi can read and edit files in this workspace</span>
          <span><kbd className="px-1 py-0.5 text-[10px] font-mono text-fg bg-bg border border-border rounded">↵</kbd> send</span>
        </div>
      </div>
    </aside>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 border border-border rounded-md bg-surface text-[12px]">
        <div className="w-5 h-5 grid place-items-center rounded text-muted bg-bg/50">
          <Terminal size={13} />
        </div>
        <span className="min-w-0 flex-1">{message.text}</span>
        <span className={cn('text-[10px] font-mono uppercase tracking-[0.05em]', message.toolStatus === 'completed' ? 'text-accent' : 'text-muted')}>
          {message.toolStatus === 'in_progress' ? 'running' : message.toolStatus ?? 'queued'}
        </span>
      </div>
    );
  }
  return (
    <div className={cn('flex items-start', message.role === 'user' && 'justify-end')}>
      <div className={cn(
        'max-w-[80%] px-3 py-2 rounded-2xl text-[13px] leading-[1.45]',
        message.role === 'user'
          ? 'bg-accent text-fg-on-accent rounded-br-sm'
          : 'bg-surface border border-border text-fg rounded-bl-sm',
      )}>
        {message.role === 'assistant' && (
          <div className="flex items-center gap-1 text-accent text-[10px] uppercase tracking-[0.05em] mb-1">
            <Sparkles size={12} /> Pi
          </div>
        )}
        {message.text ? message.text : message.streaming ? (
          <span className="inline-flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
          </span>
        ) : null}
        {message.streaming && <span className="inline-block w-0.5 h-3.5 bg-accent ml-0.5 align-middle animate-pulse" />}
      </div>
    </div>
  );
}
