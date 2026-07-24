// ponytail: extracted from App.tsx. Reads from the workspace context.
// The panel handles its own scroll-to-bottom behavior with a ref; that
// stays local because no other route needs it.

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowUp, Bot, MessageSquare, Send, Sparkles, Terminal, Zap } from 'lucide-react';
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

  return (
    <aside className="panel agent-panel">
      <div className="agent-header">
        <div className="agent-title">
          <Button variant="ghost" size="icon" className="mobile-back" onClick={() => navigate({ to: '/files' })} aria-label="Back to explorer"><ArrowLeft size={17} /></Button>
          <div className="agent-avatar"><Bot size={17} /></div>
          <div><div className="panel-kicker">PI / ACP</div><h2>Pi agent</h2></div>
        </div>
        <div className={cn('agent-status', (agentConnection === 'error' || agentConnection === 'idle') && 'agent-status-muted', agentConnection === 'error' && 'agent-status-error')}>
          <span className={cn('status-dot', agentConnection === 'thinking' && 'status-dot-pulse')} />{statusLabel}
        </div>
      </div>
      <div className="agent-context"><div className="context-icon"><Zap size={14} /></div><div><span className="context-label">WORKING IN</span><strong title={workspace.path}>{workspace.name}</strong></div></div>
      <AdapterPicker adapters={adapters} active={activeAdapter} onSelect={store.setActiveAdapter} />
      <ScrollArea className="chat-scroll" ref={messagesRef}>
        <div className="chat-messages" aria-live="polite">
          {agentConfigured === false && <div className="agent-setup-note"><Terminal size={15} /><div><strong>Pi ACP will start on first message.</strong><span>Make sure <code>pi</code> and a model provider are configured on this machine.</span></div></div>}
          {chatMessages.map((message) => <ChatBubble key={message.id} message={message} />)}
          {agentBusy && chatMessages.every((message) => !message.streaming) && <div className="thinking-row"><span className="thinking-dots"><i /><i /><i /></span> Pi is thinking</div>}
        </div>
      </ScrollArea>
      <div className="agent-compose">
        {chatMessages.length <= 1 && <div className="suggestions"><button type="button" onClick={() => void store.sendChat('Give me a quick tour of this workspace')}>Tour this workspace <ArrowUp size={12} /></button><button type="button" onClick={() => void store.sendChat('Find the main entry point')}>Find the entry point <ArrowUp size={12} /></button></div>}
        <form className="chat-form" onSubmit={submit}>
          <textarea value={chatInput} onChange={(event) => store.setChatInput(event.target.value)} onKeyDown={handleKey} placeholder="Ask Pi anything…" rows={1} aria-label="Message Pi agent" />
          <Button type="submit" size="icon" disabled={!chatInput.trim() || agentBusy} aria-label="Send message"><Send size={16} /></Button>
        </form>
        <div className="compose-hint"><span>Pi can read and edit files in this workspace</span><span><kbd>↵</kbd> send</span></div>
      </div>
    </aside>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') return <div className="tool-message"><div className="tool-icon"><Terminal size={13} /></div><span>{message.text}</span><span className={cn('tool-state', message.toolStatus === 'completed' && 'tool-state-done')}>{message.toolStatus === 'in_progress' ? 'running' : message.toolStatus ?? 'queued'}</span></div>;
  return (
    <div className={cn('chat-bubble-row', message.role === 'user' && 'chat-bubble-row-user')}>
      <div className={cn('chat-bubble', message.role === 'user' ? 'user-bubble' : 'assistant-bubble')}>
        {message.role === 'assistant' && <div className="bubble-label"><Sparkles size={12} /> Pi</div>}
        {message.text ? <div className="bubble-text">{message.text}</div> : message.streaming && <div className="bubble-loading"><span /><span /><span /></div>}
        {message.streaming && <span className="stream-caret" />}
      </div>
    </div>
  );
}

function AdapterPicker({ adapters, active, onSelect }: {
  adapters: { id: string; label: string; installed: boolean; active: boolean }[];
  active: string | null;
  onSelect: (id: string) => void;
}) {
  if (adapters.length <= 1) return null;
  return (
    <div className="adapter-picker" role="tablist" aria-label="Adapter">
      {adapters.map((adapter) => (
        <button
          key={adapter.id}
          type="button"
          role="tab"
          aria-selected={adapter.id === active}
          className={cn('adapter-chip', adapter.id === active && 'adapter-chip-active', !adapter.installed && 'adapter-chip-missing')}
          onClick={() => onSelect(adapter.id)}
          title={adapter.installed ? `Use ${adapter.label}` : `${adapter.label} is not installed`}
        >
          {adapter.label}
          {!adapter.installed && <span className="adapter-chip-dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
