// Shown next to the Settings checkbox and saved with every consent change.
export const NEWSLETTER_CONSENT =
  "Email me the weekly Squid host newsletter with product updates and hosting tips. I can unsubscribe at any time from Settings or any newsletter email.";
export type NewsletterConsent = {
  subscribed: boolean;
  updatedAt: string | null;
};
