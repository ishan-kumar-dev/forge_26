import nodemailer from 'nodemailer';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function notifyStatusChange({ reference, title, contact }, status, note = '') {
 const email = String(contact || '').trim();
 if (!emailPattern.test(email)) return { attempted: false, delivered: false, detail: 'No email contact was provided.' };
 if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return { attempted: false, delivered: false, detail: 'SMTP is not configured.' };
 try {
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
  await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: `Civic Resolve ${reference}: ${status}`, text: `Your report “${title}” is now ${status}.\n\n${note ? `Municipal update: ${note}\n\n` : ''}Track it at ${process.env.PUBLIC_APP_URL || 'your Civic Resolve portal'} using reference ${reference}.` });
  return { attempted: true, delivered: true, detail: `Email sent to ${email.replace(/^(.).+(@.+)$/, '$1***$2')}.` };
 } catch (error) { console.warn('Notification delivery failed:', error.message); return { attempted: true, delivered: false, detail: 'SMTP delivery failed.' }; }
}
