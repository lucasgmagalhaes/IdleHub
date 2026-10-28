import { useEffect, useState, type FormEvent } from "react";
import type { Settings } from "../backend";
import { t } from "../strings";

/** Frame caps offered; the CPU cost of each is in docs/PERFORMANCE.md. */
export const FPS_OPTIONS = [60, 45, 30, 24, 20, 15, 10, 5, 2, 1];

const FIELDS: { key: keyof Settings; label: string; help: string }[] = [
  { key: "singlePaneFps", label: t.singlePaneFps, help: t.singlePaneHelp },
  { key: "multiPaneFps", label: t.multiPaneFps, help: t.multiPaneHelp },
  { key: "hiddenFps", label: t.hiddenFps, help: t.hiddenHelp },
];

interface SettingsViewProps {
  load(): Promise<Settings>;
  onSave(settings: Settings): Promise<boolean>;
  onClose(): void;
}

/**
 * Takes the place of the panes while open; the games keep running parked
 * behind it, so nothing overlaps the native game webviews.
 */
export function SettingsView({ load, onSave, onClose }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then((s) => !cancelled && setSettings(s), () => {});
    return () => {
      cancelled = true;
    };
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (settings && (await onSave(settings))) onClose();
  };

  return (
    <section className="settings" aria-label={t.settings}>
      <h2>{t.settings}</h2>
      {settings && (
        <form onSubmit={submit}>
          <fieldset>
            <legend>{t.frameRates}</legend>
            <p className="help">{t.frameRatesHelp}</p>
            {FIELDS.map(({ key, label, help }) => (
              <div key={key} className="field">
                <label htmlFor={key}>{label}</label>
                <select
                  id={key}
                  value={String(settings[key])}
                  onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                >
                  {FPS_OPTIONS.map((fps) => (
                    <option key={fps} value={fps}>
                      {t.fps(fps)}
                    </option>
                  ))}
                </select>
                <p className="help">{help}</p>
              </div>
            ))}
          </fieldset>
          <div className="settings-actions">
            <button type="button" onClick={onClose}>
              {t.cancel}
            </button>
            <button type="submit" className="primary">
              {t.save}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
