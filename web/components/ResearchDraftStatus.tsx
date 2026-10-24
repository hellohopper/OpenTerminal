"use client";
import { useI18n } from '../lib/use-i18n';
export default function ResearchDraftStatus({ draft }: { draft: { dirty: boolean; restored: boolean; error: boolean; reset: () => void } }) {
  const { t } = useI18n();
  if (!draft.dirty && !draft.error) return null;
  return <div className="flex flex-wrap gap-2 items-center"><p role={draft.error ? 'alert' : 'status'} className={draft.error ? 'down' : 'dim'}>{t(draft.error ? 'Draft storage unavailable. Save before leaving.' : draft.restored ? 'Research draft restored on this device.' : 'Research draft saved on this device.')}</p>{draft.dirty && <button type="button" className="term-btn" onClick={() => { if (confirm(t('Discard this unsaved draft?'))) draft.reset(); }}>{t('Discard draft')}</button>}</div>;
}
