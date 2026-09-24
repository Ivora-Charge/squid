# Security

Do not post vulnerabilities, credentials, guest information, or payment payloads in public issues. Use the repository's private vulnerability reporting feature when available, or contact the deployment's operator through their published private support channel. This repository does not invent a security contact address.

Include the affected version, minimal reproduction, expected access boundary, and impact. Use redacted test data. Do not test with another host's resources or a charger without its owner's permission.

Server-only secrets include the Supabase service-role key, Ivora API key, Stripe secret/signing keys, Resend API key, database URL, and cron secret. Only `NEXT_PUBLIC_APP_URL` is intended to be public. Rotate compromised credentials with the provider and redeploy; rotating the service-role key also invalidates guest session cookies.

This is a reference application. It includes row-level security, validated host sessions, origin checks for browser writes, signed Stripe webhooks, private guest cookies, database leases, and saved request identities. Review your deployment's email delivery, rate limiting, monitoring, backup, and operator recovery process before offering a live service. See the README and architecture guide for known operational limits.
