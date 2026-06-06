'use client';

import { useState } from 'react';

export function ReasoningCell({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) {
    return <span className="text-neutral-400">—</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      title={text}
      aria-expanded={expanded}
      className="block max-w-xs cursor-pointer text-left text-neutral-700 hover:text-neutral-900"
    >
      <span className={expanded ? 'whitespace-normal' : 'block truncate'}>{text}</span>
    </button>
  );
}
