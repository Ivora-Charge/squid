import { Brand } from "@/components/ui";
import { ResetPassword } from "@/components/reset-password";
import { user } from "@/lib/server/db";
import { supabaseConfigured } from "@/lib/server/config";
export const metadata = {
  title: "Set your password",
  robots: { index: false, follow: false },
};
export default async function ResetPage() {
  const host = supabaseConfigured() ? await user() : null;
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <Brand />
        <p className="eyebrow">A FRESH START</p>
        <h1>
          Your space.
          <br />
          Your password.
        </h1>
        <ResetPassword signedIn={!!host} />
      </div>
      <div className="auth-glow" />
    </main>
  );
}
