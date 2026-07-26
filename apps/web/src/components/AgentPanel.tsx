// ponytail: agent panel — chat + sessions drawer. Adapter choice lives in
// Settings only; this tab just shows which one settings selected.

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowUp, Bot, Brain, History, MessageSquarePlus, Send, Sparkles, Terminal, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from './ui/drawer';
import { useWorkspaceStore, type ChatMessage } from '../workspace-context';
import { cn } from '../lib/utils';
import { routeWithWorkspace } from '../router';
import { marked } from 'marked';

// ponytail: strip raw HTML; GFM is enough for agent chat.
marked.setOptions({ gfm: true, breaks: true });
marked.use({ renderer: { html() { return ''; } } });

export function AgentPanel() {
  const store = useWorkspaceStore();
  const navigate = useNavigate();
  const { workspace } = store;
  const {
    chatMessages,
    chatInput,
    agentBusy,
    agentConnection,
    agentConfigured,
    activeAdapter,
    agentSessionsList,
    activeSessionId,
  } = store;

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    if (!workspace) return;
    void store.refreshAgentSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.path]);

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
    <aside className="bg-[#0d141d] flex flex-col h-full min-w-0 overflow-hidden">
      <div className="h-16 shrink-0 flex items-center justify-between pl-4 pr-3.5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: routeWithWorkspace('/files', workspace.path) })} aria-label="Back to files" className="md:hidden shrink-0">
            <ArrowLeft size={17} />
          </Button>
          <div className="w-[28px] h-[28px] shrink-0 grid place-items-center rounded-md text-blue bg-blue/10">
            <Bot size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase truncate">
              {activeAdapter ? activeAdapter.toUpperCase() : 'AGENT'} / ACP
            </div>
            <h2 className="m-0 mt-1 text-fg text-sm font-semibold tracking-[-0.02em]">Agent</h2>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSessionsOpen(true);
              void store.refreshAgentSessions();
            }}
            disabled={agentBusy}
            aria-label="Sessions"
            title="Sessions"
          >
            <History size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void store.newAgentSession()}
            disabled={agentBusy}
            aria-label="New session"
            title="New session"
          >
            <MessageSquarePlus size={15} />
          </Button>
          <div className={cn('flex items-center gap-2 text-[11px] font-mono', statusTone)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', dotTone)} />
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 mb-1 mx-3.5 p-2 border border-purple/15 rounded-md bg-purple/[0.045] min-w-0">
        <div className="min-w-0 flex-1">
          <span className="text-subtle font-mono text-[8px] tracking-[0.1em]">WORKING IN</span>
          <strong title={workspace.path} className="block text-[#d9cef2] font-mono text-[11px] font-medium truncate">{workspace.name}</strong>
        </div>
        {activeSessionId ? (
          <button
            type="button"
            onClick={() => {
              setSessionsOpen(true);
              void store.refreshAgentSessions();
            }}
            className="shrink-0 max-w-[40%] truncate px-1.5 py-0.5 border border-border rounded bg-bg/60 text-muted font-mono text-[10px]"
            title={activeSessionId}
          >
            {agentSessionsList.find((s) => s.sessionId === activeSessionId)?.title?.trim()
              || activeSessionId.slice(0, 8)}
          </button>
        ) : null}
      </div>

      <div ref={messagesRef} className="ui-scroll-area flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-2 px-3 pt-2 pb-4 min-w-0" aria-live="polite">
          {agentConfigured === false && (
            <div className="flex items-start gap-2 px-3 py-2.5 border border-blue/15 rounded-md bg-blue/[0.04] text-[12px] text-blue min-w-0">
              <Terminal size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                <strong className="block text-fg">ACP starts on first message.</strong>
                <span>
                  Set the default adapter in Settings. Make sure the binary and a model provider are configured on this machine.
                </span>
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
              Agent is thinking
            </div>
          )}
        </div>
      </div>
      <div className="px-3 pb-3 shrink-0 min-w-0">
        {chatMessages.length <= 1 && (
          <div className="flex gap-1.5 overflow-x-auto py-0 mb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        <form onSubmit={submit} className="flex items-center gap-1.5 mb-1 min-w-0">
          <textarea
            value={chatInput}
            onChange={(event) => store.setChatInput(event.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask the agent anything…"
            rows={1}
            aria-label="Message agent"
            className="flex-1 min-w-0 min-h-9 max-h-40 px-3 py-2 border border-border rounded-md bg-bg text-fg text-[13px] resize-none outline-none focus:border-accent/55 focus:shadow-[0_0_0_3px_rgba(141,244,189,0.08)] placeholder:text-subtle"
          />
          <Button type="submit" size="icon" disabled={!chatInput.trim() || agentBusy} aria-label="Send message" className="shrink-0">
            <Send size={16} />
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2 text-subtle text-[9px] font-mono min-w-0">
          <span className="min-w-0 truncate">Agent can read and edit files in this workspace</span>
          <span className="shrink-0"><kbd className="px-1 py-0.5 text-[10px] font-mono text-fg bg-bg border border-border rounded">↵</kbd> send</span>
        </div>
      </div>

      <Drawer open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DrawerContent className="max-h-[92dvh] bg-[#101821] border-border-bright">
          <DrawerHeader className="text-left border-b border-border pb-4">
            <div className="text-subtle font-mono text-[9px] font-medium tracking-[0.13em] leading-none uppercase">
              AGENT / SESSIONS
            </div>
            <DrawerTitle className="mt-[7px] text-fg text-[19px] font-semibold tracking-[-0.04em]">
              Chat sessions
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              Open, create, or delete agent chat sessions
            </DrawerDescription>
          </DrawerHeader>

          <div className="ui-scroll-area flex-1 min-h-0 overflow-y-auto px-3 py-3">
            {agentSessionsList.length === 0 ? (
              <p className="m-0 px-2 py-8 text-center text-muted text-[12px]">
                No sessions yet. Send a message or create one.
              </p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                {agentSessionsList.map((session) => {
                  const active = session.sessionId === activeSessionId || session.active;
                  const label = session.title?.trim() || session.sessionId.slice(0, 8);
                  return (
                    <li key={session.sessionId}>
                      <div
                        className={cn(
                          'flex items-center gap-1.5 rounded-md border px-2 py-2',
                          active ? 'border-accent/35 bg-accent/[0.07]' : 'border-border bg-bg/40',
                        )}
                      >
                        <button
                          type="button"
                          disabled={agentBusy}
                          onClick={() => {
                            if (session.sessionId === activeSessionId) {
                              setSessionsOpen(false);
                              return;
                            }
                            void store.loadAgentSession(session.sessionId).then(() => setSessionsOpen(false));
                          }}
                          className="min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer disabled:opacity-50"
                        >
                          <span className="block truncate text-fg text-[13px] font-medium">{label}</span>
                          <span className="block truncate text-subtle font-mono text-[10px]">
                            {session.sessionId.slice(0, 12)}
                            {session.updatedAt ? ` · ${formatWhen(session.updatedAt)}` : ''}
                            {active ? ' · active' : ''}
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted hover:text-danger"
                          disabled={agentBusy}
                          onClick={() => void store.closeAgentSession(session.sessionId)}
                          aria-label={`Delete session ${label}`}
                          title="Delete session"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DrawerFooter className="flex-row items-center justify-between gap-2.5 border-t border-border pt-[15px] pb-[calc(17px+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-2 text-subtle text-[10px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-strong" />
              {agentSessionsList.length} session{agentSessionsList.length === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              <DrawerClose asChild>
                <Button variant="ghost">Close</Button>
              </DrawerClose>
              <Button
                disabled={agentBusy}
                onClick={() => {
                  void store.newAgentSession().then(() => setSessionsOpen(false));
                }}
              >
                <MessageSquarePlus size={16} /> New session
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </aside>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const html = useMemo(
    () => (message.role !== 'tool' && message.text ? marked.parse(message.text, { async: false }) as string : ''),
    [message.role, message.text],
  );

  // Hide finished bubbles with nothing to show (empty stream open/close).
  if (message.role === 'tool') {
    if (!message.text.trim() && !message.toolDetail?.trim() && !message.streaming) return null;
  } else if (!message.text.trim() && !message.streaming) {
    return null;
  }

  if (message.role === 'tool') {
    return (
      <div className="flex flex-col gap-1 px-2 py-1 border border-border rounded-md bg-surface text-[11px] min-w-0 max-w-full">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-4 h-4 grid place-items-center rounded text-muted bg-bg/50 shrink-0">
            <Terminal size={11} />
          </div>
          <span className="min-w-0 flex-1 truncate">{message.text || 'Tool'}</span>
          <span className={cn(
            'shrink-0 text-[9px] font-mono uppercase tracking-[0.05em]',
            message.toolStatus === 'completed' ? 'text-accent' : message.toolStatus === 'failed' ? 'text-danger' : 'text-muted',
          )}>
            {message.toolStatus === 'in_progress' ? 'running' : message.toolStatus ?? 'queued'}
          </span>
        </div>
        {message.toolDetail ? (
          <pre className="m-0 max-h-28 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded bg-bg/50 px-1.5 py-1 font-mono text-[10px] leading-[1.35] text-muted">
            {message.toolDetail}
          </pre>
        ) : null}
      </div>
    );
  }
  if (message.role === 'thought') {
    return (
      <div className="flex flex-col gap-1 px-2 py-1 border border-dashed border-border/80 rounded-md bg-bg/40 text-[11px] min-w-0 max-w-full text-muted">
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.05em] text-subtle">
          <Brain size={10} />
          Thinking
        </div>
        {message.text ? (
          <div className="chat-md chat-md-thought break-words [overflow-wrap:anywhere] italic opacity-90" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="inline-flex gap-1">
            <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={cn('flex items-start min-w-0 max-w-full', message.role === 'user' && 'justify-end')}>
      <div className={cn(
        'max-w-[min(85%,100%)] min-w-0 px-2.5 py-1.5 rounded-xl text-[12px] leading-[1.4]',
        message.role === 'user'
          ? 'bg-accent text-fg-on-accent rounded-br-sm'
          : 'bg-surface border border-border text-fg rounded-bl-sm',
      )}>
        {message.role === 'assistant' && (
          <div className="flex items-center gap-1 text-accent text-[9px] uppercase tracking-[0.05em] mb-0.5">
            <Sparkles size={10} /> Agent
          </div>
        )}
        {message.text ? (
          <div className="flex items-end gap-0.5 min-w-0">
            <div
              className={cn('chat-md break-words [overflow-wrap:anywhere] min-w-0', message.role === 'user' && 'chat-md-user')}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {message.streaming ? <span className="inline-block w-0.5 h-3 bg-accent shrink-0 mb-0.5 animate-pulse" /> : null}
          </div>
        ) : (
          <span className="inline-flex gap-1">
            <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-muted animate-pulse" />
          </span>
        )}
      </div>
    </div>
  );
}
