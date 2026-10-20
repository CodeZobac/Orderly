import Tracker from "@/components/tracker";
import { notFound } from "next/navigation";
import { Suspense } from "react";
type Props = { params: Promise<{ view: string[] }> };
export default function WorkspacePage(props: Props) {
  return (
    <Suspense
      fallback={
        <main>
          <p role="status">Loading workspace…</p>
        </main>
      }
    >
      <WorkspaceRoute {...props} />
    </Suspense>
  );
}
async function WorkspaceRoute({ params }: Props) {
  const { view } = await params;
  if (
    !(
      view.length === 1 &&
      ["projects", "timesheet", "settings", "billing"].includes(view[0])
    ) &&
    !(view.length === 2 && view[0] === "tasks") &&
    !(view.length === 2 && view[0] === "settings" && view[1] === "connections")
  )
    notFound();
  return <Tracker />;
}
