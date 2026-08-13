/**
 * User-facing projection of the agent's private working note.
 * The server owns the note lifecycle; this component presents it as revisable
 * interpretation and never as a verified profile or objective preference.
 */
import dayjs from 'dayjs';
import { NotebookPen, PencilLine, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type AgentProgressProps = {
  isSubmittingGuidance: boolean;
  onGuidance(content: string): Promise<void>;
  workingNote?: DiscoverySnapshot['workingNote'];
};

export function AgentProgress({
  isSubmittingGuidance,
  onGuidance,
  workingNote,
}: AgentProgressProps) {
  const [isRefining, setIsRefining] = useState(false);
  const [guidance, setGuidance] = useState('');

  const submitGuidance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = guidance.trim();
    if (!content || isSubmittingGuidance) {
      return;
    }
    try {
      await onGuidance(content);
    } catch {
      return;
    }
    setGuidance('');
    setIsRefining(false);
  };

  return (
    <section className="agent-note-card">
      <header className="card-heading">
        <div className="card-heading__icon" aria-hidden="true">
          <NotebookPen size={18} />
        </div>
        <div>
          <p className="section-label">Working understanding</p>
          <h2>What your agent is carrying forward</h2>
          <p>
            This private note connects your interest, earlier findings, and
            guidance across background checks. It is a revisable work note,
            not a score or a claim about you.
          </p>
        </div>
      </header>

      {workingNote ? (
        <>
          <div className="agent-note">
            <p>{workingNote.content}</p>
            <footer>
              <small>
                Updated after an agent wake · {' '}
                {dayjs(workingNote.createdAt).format('MMM D, HH:mm')}
              </small>
              {!isRefining ? (
                <Button
                  onClick={() => setIsRefining(true)}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  <PencilLine size={14} />
                  Correct or refine
                </Button>
              ) : null}
            </footer>
          </div>
          {isRefining ? (
            <form className="guidance-form" onSubmit={submitGuidance}>
              <label htmlFor="agent-guidance">
                What should your agent understand differently?
              </label>
              <p>
                Write the correction in ordinary language. Your agent
                will rewrite its private note; this does not post to the network.
              </p>
              <textarea
                autoFocus
                id="agent-guidance"
                maxLength={1_600}
                onChange={(event) => setGuidance(event.target.value)}
                placeholder="For example: weak signals are useful again, but label them clearly..."
                rows={4}
                value={guidance}
              />
              <footer>
                <span>{guidance.length.toLocaleString()} / 1,600</span>
                <div>
                  <Button
                    disabled={isSubmittingGuidance}
                    onClick={() => {
                      setGuidance('');
                      setIsRefining(false);
                    }}
                    size="small"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={!guidance.trim() || isSubmittingGuidance}
                    size="small"
                    type="submit"
                  >
                    <Send size={14} />
                    {isSubmittingGuidance ? 'Saving…' : 'Save guidance'}
                  </Button>
                </div>
              </footer>
            </form>
          ) : null}
        </>
      ) : (
        <div className="agent-note agent-note--empty">
          <p>
            No working note yet. Your agent will create one when an
            interest, finding, or guidance establishes context worth carrying
            into later checks.
          </p>
        </div>
      )}
    </section>
  );
}
