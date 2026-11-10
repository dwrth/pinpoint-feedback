"use client";

import { useState, type FormEvent } from "react";

export function ContactForm() {
  const [sent, setSent] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }

  if (sent) return <p className="card">Thanks! We&apos;ll be in touch within one business day.</p>;

  return (
    <form className="card contact" onSubmit={onSubmit}>
      <label>
        Name
        <input name="name" autoComplete="name" required />
      </label>
      <label>
        Work email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Team size
        <select name="size" defaultValue="11-50">
          <option>1-10</option>
          <option>11-50</option>
          <option>51-200</option>
          <option>200+</option>
        </select>
      </label>
      <label className="full">
        What would you like to track?
        <textarea name="message" rows={4} />
      </label>
      <button className="button primary" type="submit">
        Request demo
      </button>
    </form>
  );
}
