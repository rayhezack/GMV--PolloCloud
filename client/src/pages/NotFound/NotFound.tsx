const NotFound = () => {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] p-8 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-1)]">页面不存在</h1>
        <p className="mt-2 text-sm text-[var(--text-2)]">请从看板导航进入可用页面。</p>
      </div>
    </main>
  );
};

export default NotFound;
