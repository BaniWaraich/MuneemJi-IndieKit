import Link from "next/link";

export function OnboardingChecklist({
  gmailConnected,
  statementUploaded,
}: {
  gmailConnected: boolean;
  statementUploaded: boolean;
}) {
  const items = [
    {
      done: gmailConnected,
      label: "Connect Gmail",
      href: "#gmail",
    },
    {
      done: statementUploaded,
      label: "Upload a bank statement",
      href: "/owner/statements",
    },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-medium text-neutral-900">Getting set up</h3>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                item.done
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-neutral-300 bg-white text-neutral-500"
              }`}
              aria-hidden
            >
              {item.done ? "✓" : ""}
            </span>
            {item.done ? (
              <span className="text-neutral-500 line-through">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-primary hover:text-primary-hover"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
