export function Placeholder({ title }: { title: string }) {
  return (
    <section className="hero">
      <p className="eyebrow mono">
        <span className="dot" aria-hidden="true" /> coming soon
      </p>
      <h1 className="serif">{title}</h1>
    </section>
  );
}
