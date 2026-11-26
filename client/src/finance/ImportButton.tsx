import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNTS, moneyKop as money, usd, type Account } from '@vudo/shared';
import { api, errorText } from '../api';
import { Modal } from '../ui/common';
import { useToast } from '../ui/toast';

interface CashReport {
  rows: number;
  added: number;
  duplicates: number;
  articlesAdded: number;
  skipped: { row: number; reason: string }[];
  byAccount: Record<Account, number>;
  usd: number;
}

/** Кнопка імпорту з Excel (.xlsx) і звіт про результат. kind: облік або план P&L. */
export function ImportButton({ kind }: { kind: 'cash' | 'pnl' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CashReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rate, setRate] = useState('');
  const rateNum = Number(rate.replace(',', '.').replace(/\s/g, ''));
  const usdSkipped = report?.skipped.filter((s) => s.reason.includes('USD')).length ?? 0;

  async function upload(f: File, usdRate?: number) {
    setBusy(true);
    setFile(f);
    try {
      const form = new FormData();
      form.append('file', f, f.name);
      const url = kind === 'cash' ? `/finance/cash/import${usdRate ? `?usdRate=${usdRate}` : ''}` : '/finance/pnl/import';
      const r = await api.upload<CashReport & { cells?: number; months?: string[] }>(url, form);
      for (const k of ['finance', 'log', 'order']) void qc.invalidateQueries({ queryKey: [k] });
      if (kind === 'cash') setReport(r);
      else toast(`P&L імпортовано: ${r.cells} значень${r.months?.length ? ` (${r.months[0]} – ${r.months.at(-1)})` : ''}`);
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
        {busy ? 'Імпорт…' : kind === 'cash' ? 'Імпорт з Excel' : 'Імпорт P&L з Excel'}
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
            У файлі: {ACCOUNTS.map((a) => `${a} ${money(report.byAccount[a])}`).join(', ')}
            {report.usd ? `, USD ${usd(report.usd)}` : ''}.
            {report.articlesAdded ? ` До статейника додано нових підстатей: ${report.articlesAdded} — перевірте для них рядок P&L.` : ''}
          </div>
          {usdSkipped > 0 && file && (
            <div className="bar" style={{ alignItems: 'flex-end' }}>
              <label className="f grow">
                У файлі є суми в доларах ({usdSkipped}). Курс, грн за $1:
                <input inputMode="decimal" value={rate} placeholder="напр. 41,50" onChange={(e) => setRate(e.target.value)} />
              </label>
              <button type="button" className="btn pri" disabled={!(rateNum > 0) || busy} onClick={() => upload(file, rateNum)}>
                Додати USD-рядки
              </button>
            </div>
          )}
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
