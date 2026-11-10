import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import { categories } from "../feedback.config";
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
        <FeedbackProvider position="bottom-right" theme="light" categories={categories} defaultCategory="bug" />
      </body>
    </html>
  );
}
