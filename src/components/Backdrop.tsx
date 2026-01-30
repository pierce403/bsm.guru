export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 bg-background" />

      <div className="absolute -top-24 left-[-14rem] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--accent)_40%,transparent)_0%,transparent_65%)] blur-3xl motion-safe:animate-[floaty_18s_ease-in-out_infinite]" />
      <div className="absolute top-32 right-[-18rem] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--accent2)_45%,transparent)_0%,transparent_70%)] blur-3xl motion-safe:animate-[floaty_22s_ease-in-out_infinite]" />
      <div className="absolute bottom-[-18rem] left-[20%] h-[42rem] w-[42rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.22)_0%,transparent_72%)] blur-3xl motion-safe:animate-[floaty_26s_ease-in-out_infinite] dark:bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.12)_0%,transparent_72%)]" />

      <div className="absolute inset-0 opacity-[0.09] mix-blend-multiply dark:mix-blend-overlay [background-image:radial-gradient(rgba(11,19,32,0.75)_1px,transparent_1px)] dark:[background-image:radial-gradient(rgba(231,237,245,0.55)_1px,transparent_1px)] [background-size:4px_4px]" />

      <div className="absolute inset-x-0 top-0 h-44 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--bg)_100%,transparent)_0%,transparent_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--bg)_100%,transparent)_0%,transparent_100%)]" />
    </div>
  );
}
