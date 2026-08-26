import { ChecklistClient } from "../../../_components/checklist-client";

export default async function OwnerChecklistPage({
  params,
}: {
  params: Promise<{ sid: string }>;
}) {
  const { sid } = await params;
  return <ChecklistClient sid={sid} />;
}
