export type RuntimeHealthSnapshot = {
  status: 'Healthy' | 'HealthyBusy';
  time_of_last_update: number;
};

export class RuntimeHealthService {
  private status: RuntimeHealthSnapshot['status'] = 'Healthy';
  private lastUpdate: number;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.lastUpdate = this.currentUnixSeconds();
  }

  markBusy(): void {
    this.transition('HealthyBusy');
  }

  markHealthy(): void {
    this.transition('Healthy');
  }

  read(): RuntimeHealthSnapshot {
    return {
      status: this.status,
      time_of_last_update: this.lastUpdate,
    };
  }

  private transition(next: RuntimeHealthSnapshot['status']): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    this.lastUpdate = this.currentUnixSeconds();
  }

  private currentUnixSeconds(): number {
    return Math.floor(this.now().getTime() / 1_000);
  }
}
