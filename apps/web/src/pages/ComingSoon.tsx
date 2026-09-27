import { PageHeader } from "../components/ui";

export default function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageHeader title={title} subtitle={`Arrives in ${phase} \u2014 not built yet`} />
      <div className="p-8">
        <p className="text-sm text-vault-500">
          This module is scoped in the project spec but not part of Phase 1.
          The route, sidebar entry and backend RBAC guard are already wired up so
          it can be filled in without restructuring anything.
        </p>
      </div>
    </div>
  );
}
