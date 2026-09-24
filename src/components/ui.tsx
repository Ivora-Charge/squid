"use client";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { X, ArrowUpRight, LoaderCircle } from "lucide-react";
export function SquidMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="37"
      height="40"
      viewBox="0 0 40 44"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 2C11 2 6 11 6 20v8c0 3-3 4-4 2v5c0 7 8 7 11 1 1 8 12 8 14 0 3 6 11 6 11-1v-5c-2 2-4 1-4-2v-8C34 11 29 2 20 2Z"
        fill="currentColor"
      />
      <ellipse cx="15" cy="21" rx="2.2" ry="3" fill="#141716" />
      <ellipse cx="25" cy="21" rx="2.2" ry="3" fill="#141716" />
    </svg>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${small ? "small" : ""}`}
      aria-label="Squid by Ivora home"
    >
      <SquidMark />
      <span>
        squid<span className="brand-by">by ivora</span>
      </span>
    </Link>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d?.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Busy({
  children = "Working…",
}: {
  children?: React.ReactNode;
}) {
  return (
    <>
      <LoaderCircle className="spin" size={17} />
      {children}
    </>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error-message" role="alert">
      {message}
    </div>
  ) : null;
}
export function Footer() {
  return (
    <footer className="site-footer">
      <Brand small />
      <span>A better stay starts with a little charge.</span>
      <Link href="/developers">
        Open source, by nature <ArrowUpRight size={14} />
      </Link>
    </footer>
  );
}
export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}
