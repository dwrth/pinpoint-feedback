import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { FeedbackProvider } from "pinpoint-feedback/nextjs";
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

  return (
    <html lang={bundle.locale} dir={bundle.dir}>
      <body>
        {children}
        {/*
          The widget negotiates between `locales` using <html lang> (set above) and the browser
          languages. Passing a single bundle instead (`locale={de}`) pins the language.
        */}
        <FeedbackProvider
          position="bottom-right"
          theme="light"
          categories={categories}
          defaultCategory="bug"
          locale={locales}
          messages={messageOverrides[bundle.locale]}
        />
      </body>
    </html>
  );
}
