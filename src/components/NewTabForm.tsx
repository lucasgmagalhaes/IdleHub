import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { t } from "../strings";

interface NewTabFormProps {
  onSubmit(label: string, url: string | undefined): Promise<boolean>;
  onCancel(): void;
}

/** Inline form in the top bar; it never overlaps the game webviews. */
export function NewTabForm({ onSubmit, onCancel }: NewTabFormProps) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit(label, url.trim() || undefined)) {
      setLabel("");
      setUrl("");
    }
  };

  return (
    <form className="new-tab-form" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <input
        aria-label={t.tabName}
        placeholder={t.tabNamePlaceholder}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        autoFocus
      />
      <input
        aria-label={t.address}
        placeholder={t.addressPlaceholder}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        type="url"
      />
      <button type="submit" className="primary">
        {t.open}
      </button>
      <button type="button" className="icon-button" aria-label={t.cancel} onClick={onCancel}>
        <X size={16} />
      </button>
    </form>
  );
}
