"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert"><h1>This page could not load</h1><p>Your saved demo data has not been deleted. Check that the local server is running, then retry.</p><button className="button" onClick={reset}>Try again</button></section>;
}
