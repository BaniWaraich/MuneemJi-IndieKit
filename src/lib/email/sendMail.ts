const sendMail = async (to: string, subject: string, html: string) => {
  console.log(
    "Sending email to",
    to,
    "with subject",
    subject,
    "and html",
    html
  );
  // I can send email from SES, Resend, or Mailgun here. Check: https://docs.indiekit.pro/setup/email
  console.warn(
    "Please implement verified sender for your email service provider: https://docs.indiekit.pro/setup/email"
  );
};

export default sendMail;
