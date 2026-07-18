import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Refine Text — AI Message Polisher",
  description:
    "Rewrite messy input into polished messages with adjustable formality and friendliness, streamed in real time.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
