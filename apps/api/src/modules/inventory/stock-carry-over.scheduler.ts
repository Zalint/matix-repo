import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DailyClosingService } from './daily-closing.service';

/**
 * Cron interne — recopie chaque nuit le stock soir J -> stock matin J+1.
 *
 * Strategie minimaliste sans cron expression :
 *   - tick toutes les 60 secondes
 *   - quand l'heure courante (Africa/Dakar) == STOCK_CARRY_OVER_HHMM, on fire
 *     le carry-over pour la date d'hier (Africa/Dakar)
 *   - anti-double-fire en memoire (par cle YYYY-MM-DD)
 *
 * Active SEULEMENT si STOCK_CARRY_OVER_ENABLED=1 (defaut OFF en dev).
 *
 * On reutilise ADMIN_PG_POOL (BYPASSRLS) car on insere des stock_movements
 * en fournissant explicitement le tenant_id (le service le gere).
 */
@Injectable()
export class StockCarryOverScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StockCarryOverScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly tz = process.env.STOCK_CARRY_OVER_TZ ?? 'Africa/Dakar';
  private readonly hhmm = process.env.STOCK_CARRY_OVER_HHMM ?? '00:30';
  private readonly lastFiredDay = new Map<string, true>();

  constructor(private readonly closing: DailyClosingService) {}

  onModuleInit(): void {
    if (process.env.STOCK_CARRY_OVER_ENABLED !== '1') {
      this.log.warn(
        'Cron stock carry-over DESACTIVE (STOCK_CARRY_OVER_ENABLED!=1).',
      );
      return;
    }
    this.log.log(
      `Cron stock carry-over ACTIF (tick 60s, fire @ ${this.hhmm} ${this.tz}).`,
    );
    this.timer = setInterval(() => {
      this.tickSafe().catch((e) =>
        this.log.error(`Tick carry-over erreur: ${(e as Error).message}`),
      );
    }, 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tickSafe(): Promise<void> {
    const now = new Date();
    const currentHHMM = this.formatHHMM(now, this.tz);
    if (currentHHMM !== this.hhmm) return;

    const today = this.formatDate(now, this.tz);
    if (this.lastFiredDay.get(today)) return;
    this.lastFiredDay.set(today, true);

    // Compute "hier" dans le fuseau : on prend la date "today" et on retire 1 jour
    const yesterday = this._addDays(today, -1);

    this.log.log(`Carry-over tick : closing_date=${yesterday}`);
    try {
      const result = await this.closing.runNightlyCarryOver(yesterday);
      this.log.log(
        `Carry-over OK : ${result.created} openings crees pour ${result.tenants} tenant(s).`,
      );
    } catch (e) {
      this.log.error(`Carry-over erreur : ${(e as Error).message}`);
    }
  }

  private formatHHMM(d: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    }).format(d);
  }

  private formatDate(d: Date, tz: string): string {
    // en-CA -> "YYYY-MM-DD"
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: tz,
    }).format(d);
  }

  private _addDays(yyyymmdd: string, delta: number): string {
    const d = new Date(yyyymmdd + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  // Helper utile pour les tests / scripts CLI
  async runNow(closingDate: string) {
    return this.closing.runNightlyCarryOver(closingDate);
  }
}
