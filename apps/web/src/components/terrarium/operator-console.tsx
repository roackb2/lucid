import { CirclePlay, Orbit, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ResetDialog } from './reset-dialog';

type OperatorConsoleProps = {
  isActive: boolean;
  isAdvancing: boolean;
  isResetting: boolean;
  isSeeding: boolean;
  onAdvance(steps: number): void;
  onReset(): void;
  onSeed(content: string): void;
};

export function OperatorConsole({
  isActive,
  isAdvancing,
  isResetting,
  isSeeding,
  onAdvance,
  onReset,
  onSeed,
}: OperatorConsoleProps) {
  const [seed, setSeed] = useState('');

  const submitSeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = seed.trim();
    if (!content) {
      return;
    }
    onSeed(content);
    setSeed('');
  };

  return (
    <section className="operator-console" aria-labelledby="operator-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operator boundary</p>
          <h2 id="operator-title">Disturb the glass</h2>
        </div>
        <span className="bounded-label">bounded autonomy</span>
      </div>

      <form className="seed-form" onSubmit={submitSeed}>
        <label htmlFor="world-seed">Place one thought into shared reality</label>
        <textarea
          id="world-seed"
          maxLength={1_200}
          onChange={(event) => setSeed(event.target.value)}
          placeholder="A city discovers that its oldest map records tomorrow..."
          rows={4}
          value={seed}
        />
        <div className="seed-form__footer">
          <span>{seed.length} / 1200</span>
          <Button disabled={!seed.trim() || isSeeding} size="small" type="submit">
            <Send size={14} />
            Whisper
          </Button>
        </div>
      </form>

      <div className="wake-controls">
        <div className="wake-controls__copy">
          <strong>Advance deliberately</strong>
          <p>
            Each wake is one durable Heddle turn with at most two world-changing
            actions. Nothing loops without you.
          </p>
        </div>
        <div className="wake-controls__buttons">
          <Button
            disabled={isActive || isAdvancing}
            onClick={() => onAdvance(1)}
            variant="secondary"
          >
            <CirclePlay size={16} />
            One wake
          </Button>
          <Button
            disabled={isActive || isAdvancing}
            onClick={() => onAdvance(3)}
          >
            <Orbit size={17} />
            Full orbit
          </Button>
        </div>
      </div>

      <footer className="operator-console__footer">
        <p>
          Reset starts a new world and new minds. Existing Heddle files are not
          deleted.
        </p>
        <ResetDialog
          disabled={isActive}
          isPending={isResetting}
          onReset={onReset}
        />
      </footer>
    </section>
  );
}
