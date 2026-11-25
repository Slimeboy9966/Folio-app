import React, { useRef, useState } from 'react';
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { GradeScaleEntry } from '../types/grades';
import {
  COLLEGE_PLUS_MINUS_GRADE_SCALE,
  PUSD_GRADE_SCALE,
} from '../data/sampleData';

interface GradeScaleViewProps {
  gradeScale: GradeScaleEntry[];
  priorGpa: number;
  priorCredits: number;
  onUpdateGradeScale: (next: GradeScaleEntry[]) => void;
  onUpdatePriorRecord: (gpa: number, credits: number) => void;
  onExportJson: () => void;
  onImportJson: (jsonText: string) => { ok: boolean; error?: string };
  onResetSampleData: () => void;
  onClearAllData: () => void;
}

export const GradeScaleView: React.FC<GradeScaleViewProps> = ({
  gradeScale,
  priorGpa,
  priorCredits,
  onUpdateGradeScale,
  onUpdatePriorRecord,
  onExportJson,
  onImportJson,
  onResetSampleData,
  onClearAllData,
}) => {
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'sample' | 'clear' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleScaleChange = (
    index: number,
    field: 'minPercent' | 'gpa',
    rawValue: string
  ) => {
    const parsed = parseFloat(rawValue);
    if (Number.isNaN(parsed)) return;
    const next = gradeScale.map((entry, idx) =>
      idx === index ? { ...entry, [field]: parsed } : entry
    );
    onUpdateGradeScale(next);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = onImportJson(String(reader.result || ''));
      setImportStatus(
        result.ok ? 'Gradebook data imported successfully.' : result.error || 'Invalid file format.'
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-7 max-w-4xl">
      {/* Grading Scale Table */}
      <section className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Letter Grade &amp; GPA Scale
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              PUSD (Amador Valley &amp; Foothill) uses unweighted 4.0 points (A+/A/A− = 4.0) plus +1.0 for AP &amp; Honors courses. Switch presets or customize any row below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onUpdateGradeScale(PUSD_GRADE_SCALE)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-sky-300 bg-blue-50/80 dark:bg-sky-500/15 hover:bg-blue-100/80 dark:hover:bg-sky-500/25 border border-blue-200/80 dark:border-sky-400/25 rounded-xl transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              PUSD / HS 4.0
            </button>
            <button
              type="button"
              onClick={() => onUpdateGradeScale(COLLEGE_PLUS_MINUS_GRADE_SCALE)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
            >
              College +/- 4.0
            </button>
          </div>
        </div>

        <div className="w-full">
          <table className="w-full text-left border-collapse table-fixed sm:table-auto">
            <thead>
              <tr className="border-b border-slate-200/70 dark:border-white/10 bg-slate-50/40 dark:bg-white/[0.02] text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3 sm:px-6 w-20 sm:w-auto">Letter</th>
                <th className="py-2.5 px-3 sm:px-6">Min %</th>
                <th className="py-2.5 px-3 sm:px-6">GPA Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/50 dark:divide-white/[0.06] text-sm">
              {gradeScale.map((entry, idx) => (
                <tr key={entry.letter} className="hover:bg-white/40 dark:hover:bg-white/[0.03]">
                  <td className="py-2.5 px-3 sm:px-6 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {entry.letter}
                  </td>
                  <td className="py-2.5 px-3 sm:px-6">
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      max={100}
                      aria-label={`Minimum percentage for ${entry.letter}`}
                      value={entry.minPercent}
                      onChange={(e) => handleScaleChange(idx, 'minPercent', e.target.value)}
                      className="w-20 sm:w-28 px-2 sm:px-2.5 py-1.5 font-mono text-xs bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-lg text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
                    />
                  </td>
                  <td className="py-2.5 px-3 sm:px-6">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={5}
                      aria-label={`GPA points for ${entry.letter}`}
                      value={entry.gpa}
                      onChange={(e) => handleScaleChange(idx, 'gpa', e.target.value)}
                      className="w-20 sm:w-28 px-2 sm:px-2.5 py-1.5 font-mono text-xs bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-lg text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Prior Academic Record */}
      <section className="glass-panel rounded-2xl p-4 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Prior Academic Record
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Used to calculate your live Cumulative GPA alongside the current term. Set prior credits to 0 if this is your first term.
        </p>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label
              htmlFor="prior-gpa"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Prior Cumulative GPA
            </label>
            <input
              id="prior-gpa"
              type="number"
              step="0.01"
              min={0}
              max={5}
              value={priorGpa}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) onUpdatePriorRecord(v, priorCredits);
              }}
              className="w-full px-3 py-2 font-mono text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
            />
          </div>

          <div>
            <label
              htmlFor="prior-credits"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Prior Completed Credits
            </label>
            <input
              id="prior-credits"
              type="number"
              step="0.5"
              min={0}
              max={300}
              value={priorCredits}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) onUpdatePriorRecord(priorGpa, v);
              }}
              className="w-full px-3 py-2 font-mono text-sm bg-white/80 dark:bg-slate-900/75 border border-slate-300/80 dark:border-white/15 rounded-xl text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-sky-400/30"
            />
          </div>
        </div>
      </section>

      {/* Backup & Data Controls */}
      <section className="glass-panel rounded-2xl p-4 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Backup &amp; Gradebook Data
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Your grades are stored locally in your browser. Export a JSON copy anytime or start with a blank slate.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onExportJson}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white/75 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/80 dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleFileImport}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => setConfirmAction('sample')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100/80 dark:bg-white/[0.05] hover:bg-slate-200/70 dark:hover:bg-white/[0.1] border border-transparent dark:border-white/10 rounded-xl transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restore Sample Data
          </button>

          <button
            type="button"
            onClick={() => setConfirmAction('clear')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-500/10 hover:bg-rose-100/80 dark:hover:bg-rose-500/20 border border-rose-200/80 dark:border-rose-400/25 rounded-xl transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All Courses
          </button>
        </div>

        {importStatus && (
          <p className="mt-3 text-xs font-medium text-blue-700 dark:text-sky-400">{importStatus}</p>
        )}

        {confirmAction && (
          <div className="mt-4 p-4 rounded-xl bg-slate-100/80 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-700 dark:text-slate-300">
              {confirmAction === 'sample'
                ? 'Replace current gradebook with the sample semester data?'
                : 'Remove all courses and assignments so you can enter your own from scratch?'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction === 'sample') onResetSampleData();
                  else onClearAllData();
                  setConfirmAction(null);
                }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
