import { recencyEmoji } from "@/domains/opportunities/recency";

/** Badge de recencia de B1 (🔥 🟢 🟡 ❄️). Decorativo: el tiempo va en texto. */
export function RecencyEmoji({ minutes }: { minutes: number }) {
  return (
    <span aria-hidden="true" className="text-[0.8125rem] leading-none">
      {recencyEmoji(minutes)}
    </span>
  );
}
