const foundations = [
  "Next.js App Router",
  "Fastify API",
  "PostgreSQL migration base",
  "Feature flags default off",
];

export default function Home() {
  return (
    <main>
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">PLATFORM FOUNDATION</p>
        <h1 id="page-title">WHICH</h1>
        <p className="tagline">고르고, 결과를 보고, 다음 질문으로.</p>
        <div className="status" role="status">
          초기 개발 환경이 준비되었습니다.
        </div>
        <ul>
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>
        <p className="next-step">
          다음 단계는 Data Architecture v1을 확정하고 Issue → Vote → Result 계약을 구현하는
          것입니다.
        </p>
      </section>
    </main>
  );
}
