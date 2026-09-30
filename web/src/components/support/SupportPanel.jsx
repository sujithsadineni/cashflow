import { useState } from 'react';
import { useDesign } from '../../design-context';
import { LINKEDIN_URL, REPO_URL, shareLinks } from '../../support-links';
import { DetailDialog } from '../ui/DetailDialog';

/**
 * "Support the project" — no payments (the owner's call): the ways to
 * help are connecting, sharing with other developers, and starring the
 * repo. Every link opens in a new tab; nothing is sent from the app.
 */

function LinkTile({ href, onClick, emoji, title, detail, vivid }) {
  const Tag = href ? 'a' : 'button';
  return (
    <Tag
      {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button', onClick })}
      className="flex items-center gap-3 rounded-xl border border-rule bg-raised p-3 text-left transition-colors hover:bg-band"
    >
      {vivid && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-band text-lg leading-none" aria-hidden="true">
          {emoji}
        </span>
      )}
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </Tag>
  );
}

export function SupportPanel({ onClose }) {
  const vivid = useDesign().design === 'vivid';
  const [copied, setCopied] = useState(false);
  const share = shareLinks();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(REPO_URL);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const content = (
    <div className="space-y-4">
      <p className="text-sm text-ink">
        Every kind of support is appreciated — a connection, a share with a fellow developer, or a star all help this
        project reach people who'd find it useful.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {LINKEDIN_URL && <LinkTile vivid={vivid} href={LINKEDIN_URL} emoji="🤝" title="Connect on LinkedIn" detail="Say hello, share feedback" />}
        <LinkTile vivid={vivid} href={REPO_URL} emoji="⭐" title="Star on GitHub" detail="The ⭐ button, top right of the page" />
        <LinkTile vivid={vivid} href={share.linkedin} emoji="📣" title="Share on LinkedIn" detail="Tell your network about it" />
        <LinkTile vivid={vivid} href={share.x} emoji="🐦" title="Share on X" detail="Post the project link" />
        <LinkTile vivid={vivid} onClick={copyLink} emoji="🔗" title={copied ? 'Link copied' : 'Copy the link'} detail={copied ? 'Paste it anywhere' : 'For a chat or an email'} />
      </div>
    </div>
  );

  return (
    <DetailDialog
      title="Support the project"
      emoji="💚"
      tint="bg-vivid-green/10"
      sections={[{ key: 'support', label: 'Thank you', content }]}
      onClose={onClose}
    />
  );
}
