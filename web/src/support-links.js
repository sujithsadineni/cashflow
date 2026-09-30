/**
 * Where the Support button's links go (components/support/). One place,
 * so changing the repo or profile is a one-line edit.
 *
 * Feature requests and error reports become GitHub issues on the public
 * repo: the app runs on each person's own machine, so there's no server
 * of ours to receive a message — GitHub is where it reaches the maintainer.
 */

export const REPO_URL = 'https://github.com/sujithsadineni/cashflow';

// The maintainer's profile, for "Connect on LinkedIn". Set to null to hide that tile.
export const LINKEDIN_URL = 'https://www.linkedin.com/in/sujith-sadineni-508322209/';

export const ISSUE_KINDS = {
  feature: { label: 'enhancement', heading: 'What would you like cashflow to do?' },
  bug: { label: 'bug', heading: 'What went wrong, and what did you expect instead?' },
};

/**
 * A "new issue" link with the title, body and label already filled in.
 * GitHub can't take an image through a URL, so `hasImage` adds a line
 * reminding the person to paste the screenshot the form copied for them.
 * `page` is the app path they were on (e.g. /cards) — never any data.
 */
export function issueUrl({ kind, title, description, page, hasImage = false }) {
  const { label, heading } = ISSUE_KINDS[kind];
  const body = [
    `### ${heading}`,
    '',
    description.trim(),
    '',
    ...(hasImage ? ['### Screenshot', '', '<!-- Your screenshot is on the clipboard: press ⌘V / Ctrl+V here to attach it. -->', ''] : []),
    '---',
    `Sent from the cashflow app${page ? ` · page \`${page}\`` : ''}`,
  ].join('\n');
  return `${REPO_URL}/issues/new?${new URLSearchParams({ title: title.trim(), body, labels: label })}`;
}

/** Share targets for "tell a fellow developer". */
export const SHARE_TEXT = 'cashflow — an open-source household expense tracker that runs on your own machine';
export const shareLinks = (url = REPO_URL) => ({
  linkedin: `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`,
  x: `https://x.com/intent/post?${new URLSearchParams({ text: SHARE_TEXT, url })}`,
});
