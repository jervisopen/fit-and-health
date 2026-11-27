import { Link } from "react-router";
import { Card } from "../components/ui.tsx";

export function ComingSoon({ title, text, module }: { title: string; text: string; module?: string }) {
  return (
    <div className="safe-top px-4 [--safe-top-pad:1.5rem]">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card className="mt-4 p-6 text-center">
        {module && <p className="text-xs font-semibold uppercase tracking-wide text-food">Coming in {module}</p>}
        <p className="mt-2 text-ink-2">{text}</p>
        <Link to="/" className="mt-4 inline-block font-semibold text-brand">Back to diary</Link>
      </Card>
    </div>
  );
}
