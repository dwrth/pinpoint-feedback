import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
import { isDemoMode, withDemoMessages } from "../demo";
import { categories } from "../feedback.config";
import { LANG_HEADER, locales, messageOverrides, pickLocale } from "../locales";
import "./globals.css";

export const metadata: Metadata = {
  title: "Northwind Analytics",
  description: "Pinpoint Feedback demo app",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const bundle = pickLocale(requestHeaders.get(LANG_HEADER), requestHeaders.get("accept-language"));
  const demo = isDemoMode();
  const messages = demo ? withDemoMessages(bundle.locale, messageOverrides[bundle.locale]) : messageOverrides[bundle.locale];

  return (
    <html lang={bundle.locale} dir={bundle.dir}>
      <body>
        {demo && (
          <div className="demo-banner" role="note">
            Demo mode: feedback is validated but not stored.{" "}
            <a href="https://github.com/dwrth/pinpoint-feedback#readme">Set up Pinpoint Feedback</a> to send reports to
            your own Notion database.
          </div>
        )}
        {children}
        {/*
          The widget negotiates between `locales` using <html lang> (set above) and the browser
          languages. Passing a single bundle instead (`locale={de}`) pins the language.
        */}
        <FeedbackProvider
          position="bottom-left"
          theme="light"
          categories={categories}
          defaultCategory="bug"
          locale={locales}
          messages={messages}
        />
      </body>
    </html>
  );
}
