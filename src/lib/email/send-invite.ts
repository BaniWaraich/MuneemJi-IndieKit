import sendMail from "./sendMail";

type InviteEmail = {
  to: string;
  inviteUrl: string;
  orgName: string;
  accountantName: string;
  expiresAt: Date;
};

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export async function sendInviteEmail(invite: InviteEmail): Promise<void> {
  const subject = `${invite.accountantName} has invited you to share documents on Muneem Ji`;
  const html = `
    <p>Hello,</p>
    <p><strong>${invite.accountantName}</strong> has invited you to share bank statements and invoices
    for <strong>${invite.orgName}</strong> via Muneem Ji.</p>
    <p><a href="${invite.inviteUrl}">Accept invitation</a></p>
    <p>This link expires on ${formatExpiry(invite.expiresAt)} IST.</p>
    <p>If you did not expect this invitation, you can safely ignore this email.</p>
  `;

  await sendMail(invite.to, subject, html);
}
