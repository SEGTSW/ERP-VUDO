import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { money } from '@vudo/shared';
import { api, errorText } from '../api';
import { Modal } from '../ui/common';
import { useToast } from '../ui/toast';

interface CashReport {
  rows: number;
  added: number;
  duplicates: number;
  articlesAdded: number;
  skipped: { row: number; reason: string }[];
  card: number;
  cash: number;
}

/** Кнопка імпорту з Excel (.xlsx) і звіт про результат. kind: облік або план P&L. */
export function ImportButton({ kind }: { kind: 'cash' | 'pnl' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CashReport | null>(null);

  async function upload(f: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f, f.name);
      const r = await api.upload<CashReport & { cells?: number; months?: string[] }>(kind === 'cash' ? '/finance/cash/import' : '/finance/pnl/import', form);
      for (const k of ['finance', 'log', 'order']) void qc.invalidateQueries({ queryKey: [k] });
      if (kind === 'cash') setReport(r);
      else toast(`План імпортовано: ${r.cells} значень${r.months?.length ? ` (${r.months[0]} – ${r.months.at(-1)})` : ''}`);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <label className="btn" style={{ cursor: 'pointer' }} title="Файл Excel (.xlsx). З Numbers: Файл → Експортувати → Excel">
        {busy ? 'Імпорт…' : kind === 'cash' ? 'Імпорт з Excel' : 'Імпорт плану з Excel'}
        <input ref={input} type="file" accept=".xlsx" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {report && (
        <Modal onClose={() => setReport(null)} labelledBy="imp-title">
          <h2 id="imp-title">Імпорт обліку</h2>
          <div className="sums">
            <div>
              <small>Рядків у файлі</small>
              <b>{report.rows}</b>
            </div>
            <div>
              <small>Додано операцій</small>
              <b>{report.added}</b>
            </div>
            <div>
              <small>Уже були (не дубльовано)</small>
              <b>{report.duplicates}</b>
            </div>
          </div>
          <div className="note num">
            У файлі: карта {money(report.card)}, готівка {money(report.cash)}.
            {report.articlesAdded ? ` До статейника додано нових підстатей: ${report.articlesAdded} — перевірте для них рядок P&L.` : ''}
          </div>
          {!!report.skipped.length && (
            <div className="warnbox">
              Пропущено рядків: {report.skipped.length}
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {report.skipped.slice(0, 20).map((s) => (
                  <li key={s.row}>
                    рядок {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="act">
            <button type="button" className="btn pri" onClick={() => setReport(null)}>
              Готово
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
