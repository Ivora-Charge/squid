import { Brand } from "@/components/ui";
import { LoginForm } from "@/components/login-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    error === "auth"
      ? "Sign-in could not be completed. Please try again using the same browser, or sign in with your password."
      : error === "expired"
        ? "That sign-in link has expired. Sign in with your password or request a new link."
        : "";
  return (
    <main id="main" className="auth-page">
      <Link className="back-link" href="/">
        <ArrowLeft size={16} /> Back to Squid
      </Link>
      <div className="auth-card">
        <Brand />
        <div className="eyebrow">MAKE YOURSELF AT HOME</div>
        <h1>
          A warm welcome.
          <br />A little extra income.
        </h1>
        <p>Your charger’s next chapter starts here.</p>
        <LoginForm initialError={message} />
        <div className="auth-divider">
          <span>just looking?</span>
        </div>
        <Link href="/demo" className="button secondary full">
          Explore the host demo
        </Link>
        <p className="fine-print">
          By continuing, you agree to the{" "}
          <Link href="/terms">terms of use</Link> and{" "}
          <Link href="/privacy">privacy notice</Link>.
        </p>
      </div>
      <div className="auth-glow" />
    </main>
  );
}
