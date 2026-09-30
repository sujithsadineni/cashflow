import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePrivacy } from '../../privacy-context';
import { issueUrl } from '../../support-links';
import { DetailDialog } from '../ui/DetailDialog';
import { Button, Field, TextArea, TextInput } from '../Form';

/**
 * "Request a feature" / "Report an error". Submitting opens a pre-filled
 * GitHub issue in a new tab. A URL can't carry an image, so a pasted or
 * chosen screenshot is put on the clipboard as PNG right before the tab
 * opens, and the issue body says to press ⌘V — one keystroke to attach it.
 *
 * Screenshots of a money app show money, so the paste box sits next to a
 * one-click switch to privacy mode.
 */

const COPY = {
  feature: {
    title: 'Request a feature',
    emoji: '💡',
    tint: 'bg-vivid-amber/15',
    titlePlaceholder: 'A short name for the idea',
    descriptionLabel: 'Describe it',
    descriptionPlaceholder: 'What would you like to do, and why would it help?',
  },
  bug: {
    title: 'Report an error',
    emoji: '🐞',
    tint: 'bg-vivid-red/10',
    titlePlaceholder: 'What broke, in a few words',
    descriptionLabel: 'What happened',
    descriptionPlaceholder: 'What did you do, what did you see, and what did you expect instead?',
  },
};

/** Clipboard image writes only reliably accept PNG, so anything else is redrawn as one. */
async function asPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function ReportForm({ kind, onClose }) {
  const copy = COPY[kind];
  const { pathname } = useLocation();
  const { privacyMode, setPrivacyMode } = usePrivacy();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState(null); // { blob, url }
  const [sent, setSent] = useState(null); // null | { copied: boolean }

  useEffect(() => () => image && URL.revokeObjectURL(image.url), [image]);

  const takeImage = (blob) => blob?.type.startsWith('image/') && setImage({ blob, url: URL.createObjectURL(blob) });
  const onPaste = (e) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      takeImage(item.getAsFile());
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    // Both the clipboard write and the new tab must start in the same tick as
    // the click — Safari refuses either once an `await` has happened. So the
    // clipboard gets a *pending* PNG (ClipboardItem accepts a promise) and the
    // tab opens immediately; only then do we wait to learn whether the copy worked.
    let copying = Promise.resolve(false);
    if (image) {
      try {
        copying = navigator.clipboard
          .write([new ClipboardItem({ 'image/png': asPng(image.blob) })])
          .then(() => true, () => false);
      } catch {
        // No async clipboard API at all — the note below says to attach it by hand.
      }
    }
    window.open(issueUrl({ kind, title, description, page: pathname, hasImage: Boolean(image) }), '_blank', 'noopener');
    setSent({ copied: await copying });
  };

  const form = sent ? (
    <div className="space-y-3 text-sm text-ink">
      <p>GitHub opened in a new tab with your {kind === 'feature' ? 'request' : 'report'} filled in — check it and press <b>Submit new issue</b>.</p>
      {image && (
        <p className="text-muted">
          {sent.copied
            ? 'Your screenshot is on the clipboard: click into the issue text and press ⌘V (Ctrl+V on Windows) to attach it.'
            : 'Your screenshot couldn’t be copied automatically — drag it into the issue text to attach it.'}
        </p>
      )}
      <p className="text-muted">A GitHub account is needed to post. Thank you for taking the time!</p>
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  ) : (
    <form onSubmit={submit} onPaste={onPaste} className="space-y-4">
      <Field label="Title">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={copy.titlePlaceholder} maxLength={120} required autoFocus />
      </Field>
      <Field label={copy.descriptionLabel}>
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={copy.descriptionPlaceholder} required />
      </Field>

      <div>
        <div className="mb-1.5 text-sm text-muted">Screenshot (optional)</div>
        {image ? (
          <div className="relative overflow-hidden rounded-lg border border-rule">
            <img src={image.url} alt="Your screenshot" className="max-h-48 w-full object-contain bg-band" />
            <button type="button" onClick={() => setImage(null)} className="absolute right-2 top-2 rounded-md bg-raised px-2 py-1 text-xs text-ink shadow-sm hover:bg-band">
              Remove
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-rule-str px-4 py-5 text-center text-sm text-muted transition-colors hover:bg-band">
            <span>Paste an image here (⌘V) or <span className="text-ink underline">choose a file</span></span>
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => takeImage(e.target.files?.[0])} />
          </label>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Screenshots can show your balances.</span>
          {privacyMode ? (
            <span className="text-earn">Privacy mode is on — amounts are hidden.</span>
          ) : (
            <button type="button" onClick={() => setPrivacyMode(true)} className="text-ink underline hover:text-earn">
              Hide amounts before capturing
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-faint">Opens GitHub in a new tab — nothing is sent from here.</span>
        <Button type="submit" disabled={!title.trim() || !description.trim()}>
          Continue on GitHub
        </Button>
      </div>
    </form>
  );

  return (
    <DetailDialog
      title={copy.title}
      emoji={copy.emoji}
      tint={copy.tint}
      sections={[{ key: 'form', label: sent ? 'Almost done' : 'Tell us about it', content: form }]}
      onClose={onClose}
    />
  );
}
