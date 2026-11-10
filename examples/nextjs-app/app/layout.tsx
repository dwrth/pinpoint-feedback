import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Northwind Analytics",
  description: "Pinpoint Feedback demo app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <FeedbackProvider position="bottom-right" theme="light" />
      </body>
    </html>
  );
}
