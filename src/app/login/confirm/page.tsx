import { Brand } from "@/components/ui";
import { ConfirmLogin } from "@/components/confirm-login";
export const metadata = {
  title: "Welcome back",
  robots: { index: false, follow: false },
};
export default function ConfirmPage() {
  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <Brand />
        <p className="eyebrow">A LITTLE GOOD ENERGY AWAITS</p>
        <h1>
          Make yourself
          <br />
          at home.
        </h1>
        <ConfirmLogin />
      </div>
      <div className="auth-glow" />
    </main>
  );
}
