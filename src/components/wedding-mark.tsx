// Decorative wedding motif: paired rings and a small botanical sprig.
export function WeddingMark() {
  return <svg className="wedding-mark" aria-hidden="true" viewBox="0 0 140 48" fill="none">
    <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle className="ring-first" cx="62" cy="27" r="13" /><circle className="ring-second" cx="79" cy="27" r="13" />
      <path d="m58 11 4-5 4 5-4 5zM9 31c14 0 21-5 29-14M18 30c-6-1-8-5-8-9 6 0 9 3 8 9Zm10-5c-5-2-6-6-5-10 5 2 7 5 5 10Zm103 6c-14 0-21-5-29-14m20 13c6-1 8-5 8-9-6 0-9 3-8 9Zm-10-5c5-2 6-6 5-10-5 2-7 5-5 10Z" />
    </g>
  </svg>;
}

// Finite, decorative motion only. No network, timers, canvas or pointer targets.
export function WeddingFlourish({ celebration = false }: { celebration?: boolean }) {
  return <span className={celebration ? "wedding-flourish celebration" : "wedding-flourish invitation-petals"} aria-hidden="true">
    {Array.from({ length: 8 }, (_, index) => <span className="wedding-petal" key={index} />)}
    {celebration && <svg className="celebration-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21 3.5 12.6C-3 6.1 5.5-2 12 5c6.5-7 15 1.1 8.5 7.6Z" /></svg>}
  </span>;
}

export function WeddingEnvelope() {
  return <svg className="wedding-envelope" aria-hidden="true" viewBox="0 0 88 64" fill="none">
    <path className="envelope-letter" d="M24 12h40v34H24z" fill="#fffdfa" stroke="#b99564" />
    <path className="envelope-letter" d="M34 21h20m-20 6h15" stroke="#b99564" strokeLinecap="round" />
    <path d="M12 25h64v32H12z" fill="#f3e7e5" stroke="#a36e80" />
    <path className="envelope-flap" d="m12 25 32 21 32-21Z" fill="#e8ccd3" stroke="#a36e80" />
    <path d="m12 57 23-18m41 18L53 39" stroke="#a36e80" />
    <path className="envelope-seal" d="M44 48c-9-5-8-12-3-12 2 0 3 1 3 2 1-1 2-2 4-2 5 0 6 7-4 12Z" fill="#85435a" />
  </svg>;
}

export function WeddingGarland() {
  return <svg className="wedding-garland" aria-hidden="true" viewBox="0 0 280 30" fill="none">
    <path className="garland-thread" d="M10 4Q140 48 270 4" stroke="#b99564" strokeWidth="1.2" pathLength="1" />
    <g fill="#e6c1ca"><path d="M47 14c-10-10-16 4 0 9 16-5 10-19 0-9ZM140 25c-9-9-14 3 0 8 14-5 9-17 0-8ZM233 14c-10-10-16 4 0 9 16-5 10-19 0-9Z" /></g>
  </svg>;
}
