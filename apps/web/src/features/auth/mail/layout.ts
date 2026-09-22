import { escapeHtml } from './escape';

/**
 * Content model every template fills in. One `url` per message: the single
 * authenticating or destination link (AUTH-3.9). No other recipient data
 * belongs here.
 */
export type AuthEmailContent = {
  readonly subject: string;
  /** Hidden preview text (inbox list preview only; never rendered visibly). */
  readonly preheader: string;
  readonly eyebrow: string;
  readonly headline: string;
  /** Plain-language paragraphs, rendered in order above the link. */
  readonly paragraphs: readonly string[];
  /** Visible text of the link/button; also used as the link's accessible name. */
  readonly linkLabel: string;
  readonly url: string;
  readonly footerNote: string;
};

const FONT_DISPLAY = "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif";
const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Daisy green tokens (globals.css), copied as static values: email clients
// cannot read CSS custom properties in inline styles.
const LIGHT = {
  background: '#f2f5f2',
  surface: '#ffffff',
  ink: '#17211b',
  inkMuted: '#5b6d61',
  border: '#d8e2d9',
  accent: '#116b36',
  accentInk: '#ffffff',
};
const DARK = {
  background: '#0a0e0c',
  surface: '#111814',
  ink: '#f4f8f3',
  inkMuted: '#a3b3a6',
  border: '#26332b',
  accent: '#3ecf7a',
  accentInk: '#052b16',
};

/** Zero-width joiners pad the hidden preheader so clients don't fall back to visible body text. */
const preheaderPadding = '‌​'.repeat(40);

function htmlParagraphs(paragraphs: readonly string[]): string {
  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${LIGHT.ink};">${escapeHtml(paragraph)}</p>`,
    )
    .join('\n');
}

/**
 * Renders one email as HTML and plain text from the same content model.
 * Pure function: no I/O, no ambient clock, no randomness. Table-based,
 * inlined-CSS markup with a `prefers-color-scheme` dark override (Apple
 * Mail, iOS Mail, Outlook desktop 2021+); other clients render the light
 * (default) styles, which are explicit on every surface so no client
 * auto-inverts them (AUTH-3.9 AC2).
 */
export function renderAuthEmailLayout(content: AuthEmailContent): {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
} {
  const safeUrl = escapeHtml(content.url);
  const safeLinkLabel = escapeHtml(content.linkLabel);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(content.subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .auth-mail-bg { background: ${DARK.background} !important; }
    .auth-mail-surface { background: ${DARK.surface} !important; border-color: ${DARK.border} !important; }
    .auth-mail-ink { color: ${DARK.ink} !important; }
    .auth-mail-ink p { color: ${DARK.ink} !important; }
    .auth-mail-muted { color: ${DARK.inkMuted} !important; }
    .auth-mail-accent { color: ${DARK.accent} !important; }
    .auth-mail-button { background: ${DARK.accent} !important; color: ${DARK.accentInk} !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${LIGHT.background};">
<span style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;mso-hide:all;">${escapeHtml(content.preheader)}${preheaderPadding}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="auth-mail-bg" style="background:${LIGHT.background};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="auth-mail-surface" style="width:100%;max-width:600px;background:${LIGHT.surface};border:1px solid ${LIGHT.border};border-radius:12px;">
<tr><td style="padding:32px 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="20" height="20" style="background:${LIGHT.accent};border-radius:999px;font-size:0;line-height:0;" class="auth-mail-accent-bg">&nbsp;</td>
<td style="padding-left:10px;font-family:${FONT_BODY};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${LIGHT.ink};" class="auth-mail-ink">Daisy</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 40px 0;">
<p style="margin:0 0 12px;font-family:${FONT_BODY};font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${LIGHT.accent};" class="auth-mail-accent">${escapeHtml(content.eyebrow)}</p>
<h1 style="margin:0 0 20px;font-family:${FONT_DISPLAY};font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;color:${LIGHT.ink};" class="auth-mail-ink">${escapeHtml(content.headline)}</h1>
<div class="auth-mail-ink">
${htmlParagraphs(content.paragraphs)}
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr>
<td style="border-radius:8px;background:${LIGHT.accent};" class="auth-mail-button">
<a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-family:${FONT_BODY};font-size:16px;font-weight:600;color:${LIGHT.accentInk};text-decoration:none;">${safeLinkLabel}</a>
</td>
</tr></table>
<p style="margin:0 0 32px;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${LIGHT.inkMuted};word-break:break-all;" class="auth-mail-muted">${safeUrl}</p>
</td></tr>
<tr><td style="padding:20px 40px 32px;border-top:1px solid ${LIGHT.border};" class="auth-mail-surface">
<p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${LIGHT.inkMuted};" class="auth-mail-muted">${escapeHtml(content.footerNote)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.headline,
    '',
    ...content.paragraphs,
    '',
    `${content.linkLabel}: ${content.url}`,
    '',
    content.footerNote,
  ].join('\n');

  return { subject: content.subject, text, html };
}
