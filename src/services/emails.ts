/** Email templates + sending helpers. Failures are logged, never thrown to the user flow. */
import type { AppConfig } from '../config.js';

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, intro: string, cta: string, url: string, outro: string) {
  const text = `${intro}\n\n${cta}: ${url}\n\n${outro}\n\n— Masjid Pulse`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#161D20">
  <h2 style="color:#01534A">${esc(title)}</h2><p>${esc(intro)}</p>
  <p><a href="${esc(url)}" style="display:inline-block;background:#01534A;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${esc(cta)}</a></p>
  <p style="font-size:13px;color:#555">Or open this link: ${esc(url)}</p><p style="font-size:13px;color:#555">${esc(outro)}</p>
  <p style="color:#FD2D25;font-weight:bold">Masjid Pulse</p></div>`;
  return { text, html };
}

async function send(config: AppConfig, to: string, subject: string, body: { text: string; html: string }) {
  try {
    await config.mailer.send({ to, subject, ...body });
    return true;
  } catch (e) {
    console.error(`Email to ${to} failed: ${(e as Error).message}`);
    return false;
  }
}

const link = (config: AppConfig, route: string, token: string) =>
  `${config.appUrl}/admin/#/${route}?token=${encodeURIComponent(token)}`;

export const sendVerificationEmail = (config: AppConfig, to: string, name: string, token: string) =>
  send(
    config,
    to,
    'Confirm your email for Masjid Pulse',
    layout(
      'Confirm your email',
      `Assalamu alaykum ${name}, please confirm your email address to start publishing to your mosque's TVs.`,
      'Confirm email',
      link(config, 'verify', token),
      'This link expires in 48 hours. If you did not create an account, ignore this email.',
    ),
  );

export const sendPasswordResetEmail = (config: AppConfig, to: string, token: string) =>
  send(
    config,
    to,
    'Reset your Masjid Pulse password',
    layout(
      'Reset your password',
      'Someone (hopefully you) asked to reset the password for this Masjid Pulse account.',
      'Choose a new password',
      link(config, 'reset', token),
      'This link expires in 1 hour and can be used once. If you did not ask for this, ignore this email.',
    ),
  );

export const sendInviteEmail = (
  config: AppConfig,
  to: string,
  inviter: string,
  mosque: string,
  role: string,
  token: string,
) =>
  send(
    config,
    to,
    `You're invited to help manage ${mosque} on Masjid Pulse`,
    layout(
      `Join ${mosque}`,
      `${inviter} invited you to ${mosque} on Masjid Pulse as ${role}.`,
      'Accept invitation',
      link(config, 'accept-invite', token),
      'This invitation expires in 7 days and can be used once.',
    ),
  );

export const sendAddedEmail = (
  config: AppConfig,
  to: string,
  inviter: string,
  mosque: string,
  role: string,
) =>
  send(config, to, `You were added to ${mosque} on Masjid Pulse`, {
    text: `${inviter} added you to ${mosque} on Masjid Pulse as ${role}. Log in at ${config.appUrl}/admin/\n\n— Masjid Pulse`,
    html: `<p>${esc(inviter)} added you to <b>${esc(mosque)}</b> on Masjid Pulse as ${esc(role)}.</p><p><a href="${esc(config.appUrl)}/admin/">Log in</a></p>`,
  });
