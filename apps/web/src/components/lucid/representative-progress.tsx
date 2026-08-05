/**
 * Participant-facing projection of the representative's private working note.
 * The server owns the note lifecycle; this component presents it as revisable
 * interpretation and never as a verified profile or objective preference.
 */
import dayjs from 'dayjs';
import { NotebookPen } from 'lucide-react';
import type { DiscoverySnapshot } from '@/lib/trpc';

type RepresentativeProgressProps = {
  workingNote?: DiscoverySnapshot['workingNote'];
};

export function RepresentativeProgress({
  workingNote,
}: RepresentativeProgressProps) {
  return (
    <section className="representative-note-card">
      <header className="card-heading">
        <div className="card-heading__icon" aria-hidden="true">
          <NotebookPen size={18} />
        </div>
        <div>
          <p className="section-label">Working understanding</p>
          <h2>What your representative is carrying forward</h2>
          <p>
            This private note connects your interest, earlier findings, and
            feedback across background checks. It is a revisable work note,
            not a score or a claim about you.
          </p>
        </div>
      </header>

      {workingNote ? (
        <div className="representative-note">
          <p>{workingNote.content}</p>
          <small>
            Updated after an agent wake · {' '}
            {dayjs(workingNote.createdAt).format('MMM D, HH:mm')}
          </small>
        </div>
      ) : (
        <div className="representative-note representative-note--empty">
          <p>
            No working note yet. Your representative will create one when an
            interest, finding, or feedback establishes context worth carrying
            into later checks.
          </p>
        </div>
      )}
    </section>
  );
}
