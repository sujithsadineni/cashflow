import { useState } from 'react';
import { LINKEDIN_URL, REPO_URL, shareLinks } from '../../lib/app/support-links';
import { DetailDialog } from '../ui/DetailDialog';
import { ArrowUpRightIcon, CheckIcon, HeartIcon, LinkIcon, LinkedInIcon, ShareIcon, StarIcon, XIcon } from './SupportIcons';

/**
 * "Support the project" — no payments (the owner's call): the ways to
 * help are connecting, sharing with other developers, and starring the
 * repo. Every link opens in a new tab; nothing is sent from the app.
 * Each tile has its own icon in every design (D334) that moves on hover,
 * and links end in an arrow that says they open a new tab.
 */

function LinkTile({ href, onClick, icon, title, detail }) {
  const Tag = href ? 'a' : 'button';
  return (
    <Tag
      {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button', onClick })}
      className="support-item flex min-w-0 items-center gap-3 rounded-xl border border-rule bg-raised p-3 text-left transition-colors hover:bg-band"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-band text-ink" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
      {href && <ArrowUpRightIcon className="shrink-0 text-faint" />}
    </Tag>
  );
}

export function SupportPanel({ onClose }) {
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
        {LINKEDIN_URL && <LinkTile href={LINKEDIN_URL} icon={<LinkedInIcon />} title="Connect on LinkedIn" detail="Say hello, share feedback" />}
        <LinkTile href={REPO_URL} icon={<StarIcon />} title="Star on GitHub" detail="The Star button on the repo page" />
        <LinkTile href={share.linkedin} icon={<ShareIcon />} title="Share on LinkedIn" detail="Tell your network about it" />
        <LinkTile href={share.x} icon={<XIcon />} title="Share on X" detail="Post the project link" />
        <LinkTile
          onClick={copyLink}
          icon={copied ? <CheckIcon key="copied" /> : <LinkIcon />}
          title={copied ? 'Link copied' : 'Copy the link'}
          detail={copied ? 'Paste it anywhere' : 'For a chat or an email'}
        />
      </div>
    </div>
  );

  return (
    <DetailDialog
      title="Support the project"
      emoji="💚"
      icon={<span className="support-heart-live flex"><HeartIcon /></span>}
      tint="bg-vivid-green/10"
      width="max-w-xl"
      sections={[{ key: 'support', label: 'Thank you', content }]}
      onClose={onClose}
    />
  );
}
